"""Validate config NGAY Ở BIÊN, trước khi dựng scene.

Vì sao có file này: config schema sống ở hai ngôn ngữ — Zod (UI) và Python (Blender).
Dự án đã gặp bốn lỗi im lặng đều "render thành công" rồi mới lộ khi nhìn ảnh. Schema
lệch giữa hai phía sẽ tạo đúng loại lỗi đó nhưng khó tìm hơn nhiều. Ở đây chặn sớm và
báo to.

Không dùng thư viện `jsonschema` vì Python nhúng của Blender không có nó, và cài gói
vào Python của Blender rất dễ vỡ khi nâng cấp. Bộ validate dưới đây chỉ phủ đúng những
từ khoá mà `schema/generate.ts` sinh ra — `test_validate_config.py` khoá tập đó lại.

  python3 scripts/blender/validate_config.py configs/turntable_loop.json
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCHEMA_PATH = os.path.join(ROOT, "schema", "scene-config.schema.json")

# Từ khoá mà validator này hiểu. Nếu bước sinh schema bắt đầu phát ra từ khoá mới mà
# không có ở đây, ta sẽ BỎ QUA nó trong im lặng -> đúng thứ cần tránh. `check_schema_
# keywords` quét và báo lỗi thay vì bỏ qua.
SUPPORTED_KEYWORDS = {
    "$schema", "$comment", "title", "description", "default",
    "type", "properties", "required", "additionalProperties", "propertyNames",
    "enum", "const",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minLength", "maxLength", "pattern",
    "items", "prefixItems", "minItems", "maxItems",
    "anyOf", "allOf", "oneOf",
}

_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "null": type(None),
}


class ConfigError(ValueError):
    """Lỗi config, kèm đường dẫn tới đúng field sai."""


def _fmt(path):
    return path or "<gốc>"


def _join(path, key):
    return f"{path}.{key}" if path else str(key)


def _type_ok(value, expected):
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    py = _TYPES.get(expected)
    if py is None:
        raise ConfigError(f"schema dùng type không hỗ trợ: {expected!r}")
    # bool là con của int trong Python — chặn để 'true' không lọt vào chỗ cần số.
    if py is not bool and isinstance(value, bool):
        return False
    return isinstance(value, py)


def _validate(value, schema, path, errors):
    if schema is False:
        errors.append(f"{_fmt(path)}: không được phép có ở đây")
        return
    if schema is True or not isinstance(schema, dict):
        return

    t = schema.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        if not any(_type_ok(value, x) for x in types):
            errors.append(
                f"{_fmt(path)}: cần kiểu {'|'.join(types)}, nhận "
                f"{type(value).__name__} ({value!r})"
            )
            return  # các phép kiểm sau giả định đúng kiểu

    if "const" in schema and value != schema["const"]:
        errors.append(f"{_fmt(path)}: phải bằng {schema['const']!r}, nhận {value!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(
            f"{_fmt(path)}: {value!r} không hợp lệ. Chọn một trong: "
            + ", ".join(repr(e) for e in schema["enum"])
        )

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        _validate_number(value, schema, path, errors)
    if isinstance(value, str):
        _validate_string(value, schema, path, errors)
    if isinstance(value, list):
        _validate_array(value, schema, path, errors)
    if isinstance(value, dict):
        _validate_object(value, schema, path, errors)

    for kw in ("allOf", "oneOf"):
        for sub in schema.get(kw, []):
            _validate(value, sub, path, errors)
    if "anyOf" in schema:
        branches = schema["anyOf"]
        if not any(not _collect(value, b, path) for b in branches):
            errors.append(f"{_fmt(path)}: không khớp dạng nào được cho phép")


def _collect(value, schema, path):
    errs = []
    _validate(value, schema, path, errs)
    return errs


def _validate_number(value, schema, path, errors):
    if "minimum" in schema and value < schema["minimum"]:
        errors.append(f"{_fmt(path)}: {value} nhỏ hơn mức tối thiểu {schema['minimum']}")
    if "maximum" in schema and value > schema["maximum"]:
        errors.append(f"{_fmt(path)}: {value} lớn hơn mức tối đa {schema['maximum']}")
    if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
        errors.append(f"{_fmt(path)}: {value} phải lớn hơn {schema['exclusiveMinimum']}")
    if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
        errors.append(f"{_fmt(path)}: {value} phải nhỏ hơn {schema['exclusiveMaximum']}")
    if "multipleOf" in schema and value % schema["multipleOf"] != 0:
        errors.append(f"{_fmt(path)}: {value} phải là bội của {schema['multipleOf']}")


def _validate_string(value, schema, path, errors):
    if "minLength" in schema and len(value) < schema["minLength"]:
        errors.append(f"{_fmt(path)}: chuỗi ngắn hơn {schema['minLength']} ký tự")
    if "maxLength" in schema and len(value) > schema["maxLength"]:
        errors.append(f"{_fmt(path)}: chuỗi dài hơn {schema['maxLength']} ký tự")
    if "pattern" in schema:
        import re

        if re.search(schema["pattern"], value) is None:
            errors.append(f"{_fmt(path)}: không khớp mẫu {schema['pattern']}")


def _validate_array(value, schema, path, errors):
    if "minItems" in schema and len(value) < schema["minItems"]:
        errors.append(
            f"{_fmt(path)}: cần ít nhất {schema['minItems']} phần tử, có {len(value)}"
        )
    if "maxItems" in schema and len(value) > schema["maxItems"]:
        errors.append(
            f"{_fmt(path)}: nhiều nhất {schema['maxItems']} phần tử, có {len(value)}"
        )

    prefix = schema.get("prefixItems", [])
    for i, sub in enumerate(prefix):
        if i < len(value):
            _validate(value[i], sub, _join(path, f"[{i}]"), errors)

    rest = schema.get("items")
    if rest is not None:
        for i in range(len(prefix), len(value)):
            _validate(value[i], rest, _join(path, f"[{i}]"), errors)


def _validate_object(value, schema, path, errors):
    props = schema.get("properties", {})
    for key in schema.get("required", []):
        if key not in value:
            errors.append(f"{_fmt(path)}: thiếu field bắt buộc {key!r}")

    names_schema = schema.get("propertyNames")
    extra = schema.get("additionalProperties")
    for key, sub_value in value.items():
        if names_schema is not None:
            _validate(key, names_schema, _join(path, f"<tên {key!r}>"), errors)
        if key in props:
            _validate(sub_value, props[key], _join(path, key), errors)
        elif extra is False:
            errors.append(
                f"{_fmt(path)}: field không nhận diện được {key!r}"
                + (f". Field hợp lệ: {', '.join(sorted(props))}" if props else "")
            )
        elif isinstance(extra, dict):
            _validate(sub_value, extra, _join(path, key), errors)


# ------------------------------------------------------- luật ngoài JSON Schema
#
# Zod `.refine()` KHÔNG xuất được sang JSON Schema, nên hai luật dưới đây phải chép
# tay sang Python. Đây chính là chỗ hai phía dễ trôi khỏi nhau nhất, nên
# `test_validate_config.py` bắt cả hai bên cùng từ chối cùng một bộ fixture.


def _validate_semantics(cfg, errors):
    channels = cfg.get("channels") or {}
    for key, spec in channels.items():
        if not isinstance(spec, dict):
            continue
        kfs = spec.get("keyframes")
        if not isinstance(kfs, list):
            continue
        frames = [k.get("frame") for k in kfs if isinstance(k, dict)]
        if any(not isinstance(f, (int, float)) for f in frames):
            continue
        if any(b <= a for a, b in zip(frames, frames[1:])):
            # Python sort lại được, nhưng nếu UI gửi sai thứ tự thì tay cầm bezier đã
            # gắn nhầm keyframe từ trước — sort không cứu được, phải chặn.
            errors.append(
                f"channels.{key}.keyframes: phải sắp xếp tăng dần theo frame và "
                f"không trùng frame (nhận {frames})"
            )

    if channels:
        render = cfg.get("render") or {}
        if render.get("frames") is None and render.get("duration") is None:
            # Thiếu độ dài thì Blender lặng lẽ render đúng 1 frame.
            errors.append(
                "render.duration: config có channels thì render.duration hoặc "
                "render.frames là bắt buộc"
            )


# ------------------------------------------------------------------------- API


def load_schema(path=SCHEMA_PATH):
    if not os.path.exists(path):
        raise ConfigError(
            f"thiếu {path}. Chạy `pnpm schema:gen` để sinh lại từ schema/scene-config.ts"
        )
    with open(path) as f:
        return json.load(f)


def check_schema_keywords(schema):
    """Báo lỗi nếu JSON Schema chứa từ khoá validator này chưa hiểu.

    Không có phép kiểm này thì từ khoá mới sẽ bị bỏ qua im lặng và ràng buộc phía
    Python lỏng hơn phía UI mà không ai biết.
    """
    unknown = set()

    def walk(node):
        if isinstance(node, list):
            for v in node:
                walk(v)
        elif isinstance(node, dict):
            for k, v in node.items():
                if k not in SUPPORTED_KEYWORDS:
                    unknown.add(k)
                # 'properties' và 'patternProperties' có key là TÊN FIELD, không phải
                # từ khoá — chỉ đi xuống giá trị.
                if k in ("properties",):
                    for sub in v.values():
                        walk(sub)
                else:
                    walk(v)

    walk(schema)
    if unknown:
        raise ConfigError(
            "JSON Schema chứa từ khoá mà validate_config.py chưa hỗ trợ: "
            + ", ".join(sorted(unknown))
            + ". Bổ sung vào SUPPORTED_KEYWORDS và cài đặt phép kiểm tương ứng."
        )


def validate(cfg, schema=None):
    """Trả về danh sách lỗi (rỗng nghĩa là hợp lệ)."""
    schema = schema if schema is not None else load_schema()
    check_schema_keywords(schema)
    errors = []
    _validate(cfg, schema, "", errors)
    _validate_semantics(cfg, errors)
    return errors


def validate_or_raise(cfg, schema=None):
    errors = validate(cfg, schema)
    if errors:
        raise ConfigError(
            "config không hợp lệ ({} lỗi):\n  - {}".format(len(errors), "\n  - ".join(errors))
        )
    return cfg


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 2
    with open(argv[0]) as f:
        cfg = json.load(f)
    errors = validate(cfg)
    if errors:
        print(f"KHÔNG HỢP LỆ — {argv[0]} ({len(errors)} lỗi)")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"hợp lệ — {argv[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
