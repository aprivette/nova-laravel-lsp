# Nova Laravel LSP Extension

**Laravel LSP** brings framework-aware completions, hovers, diagnostics, go-to-definition, and quick fixes to PHP and Blade files in Nova, using Laravel's first-party [`laravel/lsp`](https://github.com/laravel/lsp) language server.

Routes, views, config keys, translations, env variables, middleware, Inertia pages, Livewire components, policies, container bindings, validation rules, and Eloquent attributes all resolve against your actual application.

## Disclaimer

I made this for myself. This extension is essentially slop, so use it at your own risk. I have only tested it on macOS with Apple Silicon.

## Requirements

The language server is installed separately, via Composer:

```sh
composer global require laravel/lsp
```

The extension looks for the binary in Composer's global bin directories and in the usual Homebrew and `/usr/local` locations. If yours lives elsewhere, set **Server Path** in the extension preferences.

The server only starts in workspaces that have an `artisan` file at the root.

## Settings

**Server Path** — the `laravel-lsp` executable. Blank means auto-detect.

**Enable Debug Logging** — logs LSP traffic to the Extension Console.

Per-workspace, under Project Settings:

**PHP Environment** — how the server finds PHP for indexing: `auto` (tries Herd, Valet, Sail, Lando, DDEV, then local PHP), or pin it to one of `herd`, `valet`, `sail`, `lando`, `ddev`, `local`.

**PHP Command Override** — an explicit command, space separated, which takes precedence over PHP Environment. Use this when your PHP lives in a container:

Leave it blank if the project's `vendor/` directory and a working `php` are available on the host — that path is faster, since the server shells out to `artisan` frequently.

## Blade syntax

This extension contributes a `blade` syntax, so `.blade.php` files open as Blade rather than PHP. It is tree-sitter based, built on [tree-sitter-blade](https://github.com/EmranMR/tree-sitter-blade) (MIT — see `LICENSES/`), and provides:

- Directive highlighting, with control flow (`@if`, `@foreach`, `@endif`) distinguished from structural directives (`@extends`, `@include`, `@csrf`)
- `{{ }}` and `{!! !!}` echo delimiters, and `{{-- --}}` comments
- Full HTML highlighting — the grammar embeds tree-sitter-html, so markup looks the same as in a `.html` file
- Blade component and Livewire tags (`<x-alert />`, `<livewire:counter />`) styled as framework tags
- PHP highlighting inside `{{ }}`, `{!! !!}`, and `@php … @endphp`, via Nova's built-in `php_embedded` subsyntax
- JavaScript and CSS injection into `<script>`, `<style>`, and `style="…"`
- Code folding for HTML elements and Blade block directives
- Blade-aware auto-indentation, including the self-closing `@section('a', 'b')` and inline `@php(...)` forms

Because the syntax resolves as `blade`, the language server receives `languageId: blade` and enables its Blade-specific features — that ID, not the file extension, is what laravel/lsp keys off.

Directive *arguments* are not PHP-highlighted. The grammar splits them on parentheses (`@if ($user->isAdmin())` yields the separate chunks `$user->isAdmin` and `()`), so injecting PHP there would fragment each expression into independently parsed pieces. Arguments that are a single quoted string — `@include('partials.footer')` — are styled as strings; anything more complex is left unstyled rather than mis-coloured.

## Other PHP language servers

Nova can run a PHP language server of its own alongside this one — Nova 14 finds an installed Intelephense and manages it, under Settings → Languages → PHP → Language Servers.

When both are enabled for `php`, only one of them answers hovers, and Intelephense is the one Nova asks: no `textDocument/hover` request ever reaches this extension, so config keys, route names, view names, translations, and env variables show nothing on hover. Turn Intelephense off for PHP to get them back. Code actions do reach both servers, so this appears to be specific to hovers, but I have not checked every request.

Blade files are unaffected either way, since nothing else claims the `blade` syntax.

## License

This extension is MIT licensed — see `LICENSE`.

The bundled Blade grammar (`Syntaxes/libtree-sitter-blade.dylib`, compiled from [tree-sitter-blade](https://github.com/EmranMR/tree-sitter-blade)) is MIT licensed, Copyright (c) 2023 Emran Mashhadi Ramezan. Its full license text is in `LICENSES/tree-sitter-blade.LICENSE`.

## Notes

The `filesystem: readwrite` entitlement is needed because the server writes a Pest helper file to `storage/framework/testing/_pest.php`. Set `pestGenerateDocBlocks` off in the server config if you would rather it did not.

Use **Extensions → Restart Laravel LSP** after changing settings or pulling changes that alter routes or config.
