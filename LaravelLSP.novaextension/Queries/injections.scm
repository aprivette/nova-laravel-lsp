; PHP inside {{ }}, {!! !!}, @php … @endphp, and Envoy blocks.
;
; The grammar aliases these bodies to `php_only`, and Nova's bundled PHP
; extension declares `<injection><expression>^(php_only)$</expression></injection>`
; on its `php_embedded` subsyntax — a subsyntax written for exactly this, per its
; own comment: "meant for embedding PHP code directly into template languages
; like Laravel Blade and Twig without `<?php` tags."
((php_only) @injection.content
  (#set! injection.language "php_only"))

; <script> bodies
((script_element
  (raw_text) @injection.content)
 (#set! injection.language "javascript"))

; <style> bodies
((style_element
  (raw_text) @injection.content)
 (#set! injection.language "css"))

; style="…" attributes
(attribute
 (attribute_name) @_attrname
 (quoted_attribute_value
   (attribute_value) @injection.content)
 (#set! injection.language "css")
 (#set! injection.reset)
 (#match? @_attrname "(?i)^style$")
)
