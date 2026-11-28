use cssparser::{Parser, ParserInput, Token};
use quick_xml::{events::Event, Reader};
use roxmltree::{Document, ParsingOptions};

const SVG: &str = "http://www.w3.org/2000/svg";
const XLINK: &str = "http://www.w3.org/1999/xlink";
const XML: &str = "http://www.w3.org/XML/1998/namespace";

fn fragment(value: &str) -> bool {
    value.trim().strip_prefix('#').is_some_and(|id| {
        !id.is_empty() && !id.chars().any(|c| c.is_whitespace() || c.is_control())
    })
}

fn css_tokens<'i>(
    parser: &mut Parser<'i, '_>,
    depth: usize,
) -> Result<(), cssparser::ParseError<'i, ()>> {
    while !parser.is_exhausted() {
        match parser.next()?.clone() {
            Token::UnquotedUrl(url) if fragment(&url) => {}
            Token::Function(name) if name.eq_ignore_ascii_case("url") => {
                parser.parse_nested_block(|url| {
                    if fragment(url.expect_string()?) {
                        Ok(())
                    } else {
                        Err(url.new_custom_error(()))
                    }
                })?;
            }
            Token::Function(name)
                if ["image", "image-set", "-webkit-image-set", "src"]
                    .iter().any(|f| name.eq_ignore_ascii_case(f)) =>
            {
                return Err(parser.new_custom_error(()));
            }
            Token::UnquotedUrl(_) | Token::BadUrl(_) | Token::BadString(_) | Token::AtKeyword(_) => {
                return Err(parser.new_custom_error(()));
            }
            Token::Function(_) | Token::CurlyBracketBlock | Token::ParenthesisBlock | Token::SquareBracketBlock => {
                if depth == 32 {
                    return Err(parser.new_custom_error(()));
                }
                parser.parse_nested_block(|nested| css_tokens(nested, depth + 1))?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn local_css(value: &str) -> bool {
    let mut input = ParserInput::new(value);
    css_tokens(&mut Parser::new(&mut input), 0).is_ok()
}

fn bounded_xml_depth(xml: &str) -> bool {
    const MAX_DEPTH: usize = 128;
    let mut reader = Reader::from_str(xml);
    let mut depth = 0;
    loop {
        match reader.read_event() {
            Ok(Event::Start(_)) if depth < MAX_DEPTH => depth += 1,
            Ok(Event::Empty(_)) if depth < MAX_DEPTH => (),
            Ok(Event::End(_)) if depth > 0 => depth -= 1,
            Ok(Event::Start(_) | Event::Empty(_) | Event::End(_) | Event::DocType(_)) | Err(_) => return false,
            Ok(Event::Eof) => return depth == 0,
            Ok(_) => (),
        }
    }
}

pub(super) fn is_safe_svg(bytes: &[u8]) -> bool {
    let Ok(xml) = std::str::from_utf8(bytes) else { return false };
    let xml = xml.strip_prefix('\u{feff}').unwrap_or(xml);
    // roxmltree's structural parser recurses before its node budget can reject
    // a deep tree. The streaming reader bounds nesting first.
    if !bounded_xml_depth(xml) {
        return false;
    }
    let Ok(doc) = Document::parse_with_options(xml, ParsingOptions {
        allow_dtd: false,
        nodes_limit: 100_000,
        ..Default::default()
    }) else { return false };
    if !doc.root_element().has_tag_name((SVG, "svg")) {
        return false;
    }
    // roxmltree parses UTF-8 strings. Require the same encoding when a browser
    // interprets the original XML, including SVG embedded as a PDF data URL.
    if let Some(declaration) = xml.strip_prefix("<?xml").and_then(|s| s.split_once("?>")) {
        if let Some((_, value)) = declaration.0.split_once("encoding") {
            let encoding = value.split(['"', '\'']).nth(1);
            if !encoding.is_some_and(|encoding| encoding.eq_ignore_ascii_case("utf-8")) {
                return false;
            }
        }
    }
    doc.descendants().all(|node| {
        if node.is_pi() {
            return false;
        }
        if !node.is_element() {
            return true;
        }
        let name = node.tag_name();
        if name.namespace() != Some(SVG)
            || matches!(name.name(), "script" | "foreignObject" | "animate" | "animateMotion" |
                "animateTransform" | "animateColor" | "set" | "discard" | "handler" | "listener")
        {
            return false;
        }
        if name.name() == "style" {
            if node.children().any(|child| child.is_element()) {
                return false;
            }
            let css: String = node.children().filter(|child| child.is_text()).filter_map(|child| child.text()).collect();
            if !local_css(&css) {
                return false;
            }
        }
        node.attributes().all(|attr| match (attr.namespace(), attr.name()) {
            (None | Some(XLINK), "href") | (None, "src") => fragment(attr.value()),
            (Some(XML), "lang" | "space") => true,
            (None, "style" | "fill" | "stroke" | "clip-path" | "mask" | "mask-image" | "filter"
                | "cursor" | "color-profile" | "marker" | "marker-start" | "marker-mid" | "marker-end"
                | "shape-inside" | "shape-subtract") => local_css(attr.value()),
            (None, name) => !name.starts_with("on"),
            _ => false,
        })
    })
}
