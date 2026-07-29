; ===========================================================================
; HTML
;
; The Blade grammar embeds tree-sitter-html rather than injecting it, so these
; patterns mirror Nova's own HTML queries. Markup in a .blade.php file then
; looks identical to markup in a plain .html file.
; ===========================================================================

; Blade component and Livewire tags read as framework tags rather than plain
; elements. This must precede the bare (tag_name) pattern below: where two
; patterns capture the same node, the earlier one wins.
((tag_name) @tag.framework.name
  (#match? @tag.framework.name "^(x-|livewire:)"))

(tag_name) @tag.name
(erroneous_end_tag_name) @tag.name.error
(doctype) @processing.doctype

; Attribute names and values
((attribute
    (attribute_name) @tag.attribute.name
    ["="]? @tag.attribute.operator
    [
      (attribute_value) @tag.attribute.value
      (quoted_attribute_value
        ["\"" "'"] @tag.attribute.value.delimiter.left
        (_)? @tag.attribute.value
        ["\"" "'"] @tag.attribute.value.delimiter.right
      )
    ]?
  )
  (#not-match? @tag.attribute.name "(?i)^(src|href)$")
)

; Link attribute names and values
((attribute
    (attribute_name) @tag.attribute.name
    ["="]? @tag.attribute.operator
    [
      (attribute_value) @tag.attribute.value.link
      (quoted_attribute_value
        ["\"" "'"] @tag.attribute.value.delimiter.left
        (_)? @tag.attribute.value.link
        ["\"" "'"] @tag.attribute.value.delimiter.right
      )
    ]?
  )
  (#match? @tag.attribute.name "(?i)^(src|href)$")
)

(start_tag ["<" ">"] @tag.bracket)
(end_tag ["</" ">"] @tag.bracket)
(self_closing_tag ["<" "/>"] @tag.bracket)

(entity) @value.entity

; ===========================================================================
; Blade
; ===========================================================================

; {{-- Blade comments --}} and <!-- HTML comments -->
(comment) @comment

; Echo delimiters: {{ $escaped }} and {!! $raw !!}
["{{" "{!!"] @processing.interpolation.delimiter.left
["}}" "!!}"] @processing.interpolation.delimiter.right

; Control-flow directives take the conditional colour. Must precede the generic
; directive pattern below, as the earlier matching pattern wins.
;
; Alternatives are ordered longest-first where one is a prefix of another
; (canany before can, foreach before for, elseif before else) so the trailing
; \b cannot truncate a longer directive name.
([
  (directive)
  (directive_start)
  (directive_end)
 ] @keyword.condition
  (#match? @keyword.condition "^@(end)?(if|elseif|else|unless|isset|empty|switch|case|default|break|continue|foreach|forelse|for|while|each|hasSection|sectionMissing|canany|cannot|can|auth|guest|env|production|error)\\b"))

; Every remaining directive: @extends, @include, @section, @csrf, @vite, @php …
[
  (directive)
  (directive_start)
  (directive_end)
] @keyword

; Parentheses wrapping directive arguments
(["(" ")"]) @punctuation.bracket

; A directive argument that is nothing but a quoted string — @include('x.y'),
; @extends('layouts.app') — reads as a string. The grammar does not parse
; argument contents as PHP, so anything more complex is left unstyled rather
; than mis-coloured.
((parameter) @string
  (#match? @string "^\\s*('[^']*'|\"[^\"]*\")\\s*$"))
