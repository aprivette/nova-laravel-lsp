; HTML elements — mirrors Nova's own HTML fold queries.
((element
  (start_tag) @start
  (end_tag) @end)
 (#set! role tag)
)

((script_element
  (start_tag) @start
  (end_tag) @end)
 (#set! role tag)
)

((style_element
  (start_tag) @start
  (end_tag) @end)
 (#set! role tag)
)

; Blade block directives — @if/@endif, @foreach/@endforeach, @section/@endsection …
;
; Written out per node type rather than as a bracketed alternation, because a
; tree-sitter alternation cannot carry child patterns.
(conditional
  (directive_start) @start
  (directive_end) @end)

(loop
  (directive_start) @start
  (directive_end) @end)

(section
  (directive_start) @start
  (directive_end) @end)

(switch
  (directive_start) @start
  (directive_end) @end)

(stack
  (directive_start) @start
  (directive_end) @end)

(once
  (directive_start) @start
  (directive_end) @end)

(fragment
  (directive_start) @start
  (directive_end) @end)

(verbatim
  (directive_start) @start
  (directive_end) @end)

(livewire
  (directive_start) @start
  (directive_end) @end)

(envoy
  (directive_start) @start
  (directive_end) @end)

; @php … @endphp
(php_statement
  (directive_start) @start
  (directive_end) @end)
