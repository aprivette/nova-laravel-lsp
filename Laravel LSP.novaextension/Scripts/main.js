/**
 * Laravel LSP client for Nova.
 *
 * Nova exposes LSP only through the extension API, so this extension's job is to
 * locate the `laravel-lsp` binary, launch it from the Laravel project root, and
 * hand Nova a LanguageClient wired to PHP and Blade documents.
 */

const SERVER_CANDIDATES = [
    '~/.composer/vendor/bin/laravel-lsp',
    '~/.config/composer/vendor/bin/laravel-lsp',
    '/opt/homebrew/bin/laravel-lsp',
    '/usr/local/bin/laravel-lsp',
];

/**
 * Nova launches extension subprocesses with a minimal environment, so the
 * server would not otherwise find `php`, `docker`, `herd`, or `valet`.
 */
const SEARCH_PATHS = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
];

const OBSERVED_KEYS = [
    'laravelLsp.serverPath',
    'laravelLsp.phpEnvironment',
    'laravelLsp.phpCommand',
    'laravelLsp.debug',
];

var langserver = null;

/** Distinguishes clients created within one extension host. See `start`. */
var clientSerial = 0;

/** Distinguishes instances within one extension host. See `isCurrent`. */
var instanceSerial = 0;

/**
 * Clients this extension stopped on purpose. Nova reports those as invalidated
 * rather than as a clean stop, so without this the teardown of a replaced client
 * is indistinguishable from a server crash. See `onDidStop`.
 */
var deliberateStops = new WeakSet();

exports.activate = function () {
    log('Activating Laravel LSP extension.');

    // Guards against a reload that activates before the previous instance has
    // been torn down, which would leave two servers competing.
    if (langserver) {
        langserver.deactivate();
    }

    /**
     * Cleared before constructing, because the constructor's observers start a
     * server synchronously and `isCurrent` has to let that first run through
     * while this global still points at the outgoing instance.
     */
    langserver = null;
    langserver = new LaravelLanguageServer();

    nova.subscriptions.add(
        nova.commands.register('laravelLsp.restart', function () {
            if (langserver) {
                // Forced: an explicit restart has to relaunch the server even
                // when nothing about the configuration has changed.
                langserver.scheduleStart(true);
            }
        })
    );
};

exports.deactivate = function () {
    log('Deactivating Laravel LSP extension.');

    if (langserver) {
        langserver.deactivate();
        langserver = null;
    }
};

class LaravelLanguageServer {
    constructor() {
        this.id = ++instanceSerial;
        this.languageClient = null;
        this.restartTimer = null;
        this.hasStarted = false;
        this.disposed = false;
        this.starting = false;
        this.activeSignature = null;
        this.observers = new CompositeDisposable();

        /**
         * An arrow function rather than the `thisValue` argument, so the
         * handler's receiver cannot depend on both config scopes honouring that
         * parameter. A handler that lost `this` would keep its debounce state
         * somewhere other than the instance, which is another route to two
         * servers.
         */
        const onChange = () => this.scheduleStart();

        for (const key of OBSERVED_KEYS) {
            this.observers.add(nova.config.observe(key, onChange));
            this.observers.add(nova.workspace.config.observe(key, onChange));
        }
    }

    deactivate() {
        /**
         * Disposing the observers stops future callbacks, but one Nova has
         * already queued still lands, and it would re-arm the debounce timer on
         * this discarded instance. The flag makes teardown final: a dead server
         * must never start a client, or it races the live instance for the same
         * identifier and Nova invalidates one of the pair.
         */
        this.disposed = true;

        this.observers.dispose();

        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        this.stop();
    }

    /**
     * Whether this instance is still the one the module recognises.
     *
     * `disposed` only becomes true when `deactivate` runs, and Nova does not
     * reliably run it — so an abandoned instance keeps its observers and its
     * debounce timer and can still reach `start`. What it cannot do is escape
     * this module scope: two clients in the console carrying *consecutive*
     * serials (`…-1`, `…-2`) proved that a duplicate always shares these globals
     * with its replacement. So the module global, not the instance's own flag, is
     * the authority on which instance may own a server.
     *
     * Null means "no instance published yet", which is the window the constructor
     * runs in.
     *
     * @returns {boolean}
     */
    isCurrent() {
        return langserver === null || langserver === this;
    }

    /**
     * `nova.config.observe` fires immediately for every key it is registered
     * against, which would otherwise start the server once per observer. Coalesce
     * those callbacks — and any rapid preference edits — into a single start.
     *
     * @param {boolean} force Restart even if the resolved settings are unchanged.
     */
    scheduleStart(force = false) {
        if (this.disposed || !this.isCurrent()) {
            log(`Ignoring a start scheduled by superseded instance ${this.id}.`);

            return;
        }

        /**
         * Starting spawns a process, and Nova can deliver a queued observer
         * callback while it does. Letting that callback through would tear down a
         * client mid-launch and arm a replacement for a server that is already
         * arriving.
         */
        if (this.starting) {
            log('Laravel LSP is already starting; ignoring the scheduled start.');

            return;
        }

        /**
         * An observer also fires when a preference is rewritten with the value
         * it already had, and one edit reaches up to eight of them across the
         * two scopes. Restarting on those throws away a warm server — and every
         * index it built — for nothing, so a run whose inputs are identical to
         * the live server's is left alone.
         */
        if (!force && this.languageClient && this.settingsSignature() === this.activeSignature) {
            log('Laravel LSP settings unchanged; keeping the running server.');
            return;
        }

        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        /**
         * Stop here rather than only inside `start` so the debounce window
         * doubles as time for the previous server process to exit before a new
         * client claims the same identifier.
         */
        this.stop();

        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.start();
        }, 500);

        // Instance and timer identity, because a duplicate server is only ever
        // diagnosable from the console after the fact.
        log(`Instance ${this.id} armed a start as timer ${this.restartTimer}.`);
    }

    start() {
        if (this.disposed || !this.isCurrent()) {
            log(`Ignoring a start from superseded instance ${this.id}.`);

            return;
        }

        /**
         * The debounce timer calls this directly, so the guard in `scheduleStart`
         * does not cover a re-entrant launch. Repeated here because this is the
         * one path on which two clients could genuinely end up running at once.
         */
        if (this.starting) {
            log('Laravel LSP is already starting; ignoring the re-entrant start.');

            return;
        }

        log(`Instance ${this.id} is starting the language server.`);

        // Cleared until a client is running, so a start that bails out early
        // cannot make the next observer callback think the server is current.
        this.activeSignature = null;

        this.stop();

        const root = nova.workspace.path;

        if (!root) {
            return;
        }

        if (!pathExists(nova.path.join(root, 'artisan'))) {
            log('No artisan file in workspace root; not starting Laravel LSP.');
            return;
        }

        const serverPath = this.resolveServerPath();

        if (!serverPath) {
            this.warnMissingServer();
            return;
        }

        /**
         * ServerOptions has no `cwd` field, and laravel/lsp expects to be launched
         * from the project root, so wrap the binary in a shell that changes
         * directory first. Paths travel through the environment to sidestep
         * quoting problems in directory names.
         */
        const serverOptions = {
            type: 'stdio',
            path: '/bin/sh',
            args: ['-c', 'cd "$LARAVEL_LSP_CWD" && exec "$LARAVEL_LSP_BIN"'],
            env: {
                LARAVEL_LSP_CWD: root,
                LARAVEL_LSP_BIN: serverPath,
                PATH: SEARCH_PATHS.join(':'),
            },
        };

        /**
         * `blade` is the syntax this extension contributes in Syntaxes/Blade.xml.
         * Mapping it to the `blade` language ID is what activates the server's
         * Blade-specific features — laravel/lsp keys off that ID, not the file
         * extension.
         */
        const clientOptions = {
            syntaxes: [
                'php',
                { syntax: 'blade', languageId: 'blade' },
            ],
            initializationOptions: this.buildInitializationOptions(),
            debug: Boolean(readSetting('laravelLsp.debug', 'boolean')),
        };

        /**
         * Nova invalidates a LanguageClient the moment a second one claims the
         * same identifier, and a fixed string leaves two ways for that to
         * happen: a reload whose predecessor's server process has not finished
         * exiting yet, and a second window open on another Laravel project,
         * where a per-host counter starts over at one. The timestamp covers the
         * second case, the counter the first, so an outgoing client can never
         * collide with its replacement.
         */
        const identifier = `laravel-lsp-${Date.now()}-${++clientSerial}`;

        const client = new LanguageClient(
            identifier,
            'Laravel LSP',
            serverOptions,
            clientOptions
        );

        client.onDidStop((error) => {
            const deliberate = deliberateStops.delete(client);

            log(`Client ${identifier} stopped${error ? ` with: ${error}` : ' cleanly'}.`);

            /**
             * Nova invalidates a client as soon as its server exits, and every
             * method on an invalidated client throws — including `dispose`. It
             * has to come out of `nova.subscriptions` here, or the disposal
             * Nova runs at unload hits a dead client and aborts the rest of the
             * teardown. A newer client may already own the slot after a
             * restart, so only release our own.
             */
            release(client);

            const wasCurrent = this.languageClient === client;

            if (wasCurrent) {
                this.languageClient = null;
            }

            if (!error) {
                return;
            }

            /**
             * Nova can deliver this seconds after the fact, and it describes a
             * client it tore down for us as invalidated rather than as stopped.
             * So an error here does not mean the user lost their server: for one
             * we replaced, or shut down ourselves, it is the expected report, and
             * the live server is answering requests the whole time. Interrupting
             * anyone over that trains them to ignore the notification that
             * matters.
             */
            if (deliberate || !wasCurrent) {
                log(`Ignoring the stop of superseded client ${identifier}: ${error}`);

                return;
            }

            log(`Laravel LSP stopped unexpectedly: ${error}`);

            if (this.hasStarted) {
                notify(
                    'Laravel LSP stopped',
                    `${error}\n\nRun Extensions → Restart Laravel LSP to try again.`
                );
            }
        });

        /**
         * Registering with `nova.subscriptions` is what terminates the server
         * process when Nova quits — `deactivate` is not guaranteed to run on
         * termination, and without this the server outlives the editor. The
         * `onDidStop` handler above is responsible for withdrawing the client
         * again before it can be disposed twice.
         */
        /**
         * Claimed before `client.start()`, not after. Starting spawns a process,
         * and anything Nova delivers while it does would otherwise find an empty
         * slot, conclude no server is running, and build a second client next to
         * this one — two servers indexing the same project, one of which Nova
         * later invalidates.
         */
        this.languageClient = client;
        this.starting = true;

        try {
            client.start();

            nova.subscriptions.add(client);
            this.hasStarted = true;
            this.activeSignature = this.settingsSignature();

            log(`Started client ${identifier} from ${serverPath} in ${root}`);
        } catch (error) {
            if (this.languageClient === client) {
                this.languageClient = null;
            }

            release(client);

            log(`Failed to start Laravel LSP: ${error}`);

            notify(
                'Could not start Laravel LSP',
                `${error}\n\nCheck the Server Path setting in the extension preferences.`
            );
        } finally {
            this.starting = false;
        }
    }

    stop() {
        const client = this.languageClient;

        if (!client) {
            return;
        }

        // Cleared first so the `onDidStop` handler leaves the slot alone.
        this.languageClient = null;

        // Withdrawn before stopping, so a throw cannot strand it in Nova's
        // subscriptions where the next disposal would trip over it.
        release(client);

        // Recorded before the stop, because Nova may report this client as
        // invalidated later and `onDidStop` has no other way to tell a shutdown
        // we asked for from a server that fell over.
        deliberateStops.add(client);

        /**
         * `stop` throws "The language client has been invalidated." when the
         * server already exited on its own. There is nothing left to shut down
         * in that case, so the reference is simply discarded.
         */
        try {
            client.stop();
        } catch (error) {
            log(`Discarded an already-stopped Laravel LSP client: ${error}`);
        }
    }

    /**
     * Digest of everything that decides how the server is launched. Two runs
     * with equal digests would produce an identical server, so there is no
     * reason to replace one with the other.
     *
     * @returns {string}
     */
    settingsSignature() {
        return JSON.stringify([
            nova.workspace.path,
            this.resolveServerPath(),
            this.buildInitializationOptions(),
            Boolean(readSetting('laravelLsp.debug', 'boolean')),
        ]);
    }

    /**
     * @returns {?string} An executable laravel-lsp path, or null when none is found.
     */
    resolveServerPath() {
        const configured = readSetting('laravelLsp.serverPath', 'string');

        if (configured) {
            const expanded = nova.path.expanduser(configured.trim());

            return isExecutable(expanded) ? expanded : null;
        }

        for (const candidate of SERVER_CANDIDATES) {
            const expanded = nova.path.expanduser(candidate);

            if (isExecutable(expanded)) {
                return expanded;
            }
        }

        return null;
    }

    /**
     * @returns {{phpEnvironment?: string, phpCommand?: string[]}}
     */
    buildInitializationOptions() {
        const options = {};

        const environment = readSetting('laravelLsp.phpEnvironment', 'string');

        if (environment) {
            options.phpEnvironment = environment;
        }

        const command = readSetting('laravelLsp.phpCommand', 'string');

        if (command) {
            const parts = command.trim().split(/\s+/).filter(Boolean);

            if (parts.length > 0) {
                options.phpCommand = parts;
            }
        }

        return options;
    }

    warnMissingServer() {
        const configured = readSetting('laravelLsp.serverPath', 'string');

        const body = configured
            ? `No executable found at ${configured}. Update the Server Path setting in the extension preferences.`
            : 'Install it with "composer global require laravel/lsp", or set Server Path in the extension preferences.';

        log(`Could not locate the laravel-lsp executable. ${body}`);
        notify('laravel-lsp not found', body);
    }
}

/**
 * Reads a preference, letting a workspace value win over the global one.
 *
 * @returns {?(string|boolean)} null when neither scope holds a usable value.
 */
function readSetting(key, type) {
    const scopes = [nova.workspace.config, nova.config];

    for (const scope of scopes) {
        const value = scope.get(key, type);

        if (value === null || value === undefined) {
            continue;
        }

        if (typeof value === 'string' && value.trim() === '') {
            continue;
        }

        return value;
    }

    return null;
}

/**
 * Withdraws a client from Nova's subscriptions, tolerating one that was never
 * added or that Nova has already invalidated.
 */
function release(client) {
    try {
        nova.subscriptions.remove(client);
    } catch (error) {
        log(`Laravel LSP client was already released: ${error}`);
    }
}

function pathExists(path) {
    try {
        return nova.fs.access(path, nova.fs.F_OK);
    } catch (error) {
        return false;
    }
}

function isExecutable(path) {
    try {
        return nova.fs.access(path, nova.fs.F_OK | nova.fs.X_OK);
    } catch (error) {
        return false;
    }
}

/**
 * `inDevMode` alone is false for an installed extension, which silently
 * discarded every diagnostic in exactly the situation they are needed. The debug
 * preference opts an installed copy back in.
 */
function log(message) {
    if (nova.inDevMode() || readSetting('laravelLsp.debug', 'boolean')) {
        console.log(message);
    }
}

function notify(title, body) {
    const request = new NotificationRequest('laravel-lsp-message');

    request.title = nova.localize(title);
    request.body = nova.localize(body);

    nova.notifications.add(request);
}
