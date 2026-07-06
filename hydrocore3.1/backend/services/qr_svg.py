from __future__ import annotations

from html import escape
from typing import List


def _gf_tables() -> tuple[list[int], list[int]]:
    exp = [0] * 512
    log = [0] * 256
    x = 1
    for i in range(255):
        exp[i] = x
        log[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        exp[i] = exp[i - 255]
    return exp, log


_EXP, _LOG = _gf_tables()


def _gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _EXP[_LOG[a] + _LOG[b]]


def _rs_generator(degree: int) -> list[int]:
    poly = [1]
    for i in range(degree):
        nxt = [0] * (len(poly) + 1)
        for j, coef in enumerate(poly):
            nxt[j] ^= coef
            nxt[j + 1] ^= _gf_mul(coef, _EXP[i])
        poly = nxt
    return poly


def _rs_remainder(data: list[int], degree: int) -> list[int]:
    gen = _rs_generator(degree)
    rem = [0] * degree
    for b in data:
        factor = b ^ rem[0]
        rem = rem[1:] + [0]
        for i in range(degree):
            rem[i] ^= _gf_mul(gen[i + 1], factor)
    return rem


def _bits_to_codewords(bits: list[int], data_codewords: int) -> list[int]:
    while len(bits) % 8:
        bits.append(0)
    out = []
    for i in range(0, len(bits), 8):
        value = 0
        for bit in bits[i:i + 8]:
            value = (value << 1) | bit
        out.append(value)
    pad = 0xEC
    while len(out) < data_codewords:
        out.append(pad)
        pad = 0x11 if pad == 0xEC else 0xEC
    return out


def _append_bits(bits: list[int], value: int, length: int) -> None:
    for i in range(length - 1, -1, -1):
        bits.append((value >> i) & 1)


def _encode_bytes(text: str, data_codewords: int) -> list[int]:
    raw = text.encode("utf-8")
    if len(raw) > 78:
        raise ValueError("二维码内容过长")
    bits: list[int] = []
    _append_bits(bits, 0b0100, 4)  # byte mode
    _append_bits(bits, len(raw), 8)
    for b in raw:
        _append_bits(bits, b, 8)
    max_bits = data_codewords * 8
    _append_bits(bits, 0, min(4, max_bits - len(bits)))
    return _bits_to_codewords(bits, data_codewords)


def _mask_bit(mask: int, x: int, y: int) -> bool:
    if mask == 0:
        return (x + y) % 2 == 0
    if mask == 1:
        return y % 2 == 0
    if mask == 2:
        return x % 3 == 0
    if mask == 3:
        return (x + y) % 3 == 0
    if mask == 4:
        return (x // 3 + y // 2) % 2 == 0
    if mask == 5:
        return (x * y) % 2 + (x * y) % 3 == 0
    if mask == 6:
        return ((x * y) % 2 + (x * y) % 3) % 2 == 0
    return ((x + y) % 2 + (x * y) % 3) % 2 == 0


def _format_bits(mask: int) -> int:
    data = (1 << 3) | mask  # error correction level L
    value = data << 10
    generator = 0x537
    for i in range(14, 9, -1):
        if (value >> i) & 1:
            value ^= generator << (i - 10)
    return ((data << 10) | (value & 0x3FF)) ^ 0x5412


def _new_matrix(size: int) -> tuple[List[List[bool | None]], List[List[bool]]]:
    return [[None for _ in range(size)] for _ in range(size)], [[False for _ in range(size)] for _ in range(size)]


def _set_function(modules, reserved, x: int, y: int, dark: bool) -> None:
    size = len(modules)
    if 0 <= x < size and 0 <= y < size:
        modules[y][x] = dark
        reserved[y][x] = True


def _draw_finder(modules, reserved, cx: int, cy: int) -> None:
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            dist = max(abs(dx), abs(dy))
            _set_function(modules, reserved, cx + dx, cy + dy, dist != 2 and dist != 4)


def _draw_alignment(modules, reserved, cx: int, cy: int) -> None:
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            dist = max(abs(dx), abs(dy))
            _set_function(modules, reserved, cx + dx, cy + dy, dist != 1)


def _draw_format(modules, reserved, mask: int) -> None:
    size = len(modules)
    bits = _format_bits(mask)
    for i in range(6):
        _set_function(modules, reserved, 8, i, ((bits >> i) & 1) != 0)
    _set_function(modules, reserved, 8, 7, ((bits >> 6) & 1) != 0)
    _set_function(modules, reserved, 8, 8, ((bits >> 7) & 1) != 0)
    _set_function(modules, reserved, 7, 8, ((bits >> 8) & 1) != 0)
    for i in range(9, 15):
        _set_function(modules, reserved, 14 - i, 8, ((bits >> i) & 1) != 0)
    for i in range(8):
        _set_function(modules, reserved, size - 1 - i, 8, ((bits >> i) & 1) != 0)
    for i in range(8, 15):
        _set_function(modules, reserved, 8, size - 15 + i, ((bits >> i) & 1) != 0)
    _set_function(modules, reserved, 8, size - 8, True)


def _base_matrix(mask: int):
    version = 4
    size = version * 4 + 17
    modules, reserved = _new_matrix(size)
    _draw_finder(modules, reserved, 3, 3)
    _draw_finder(modules, reserved, size - 4, 3)
    _draw_finder(modules, reserved, 3, size - 4)
    _draw_alignment(modules, reserved, 26, 26)
    for i in range(size):
        if not reserved[6][i]:
            _set_function(modules, reserved, i, 6, i % 2 == 0)
        if not reserved[i][6]:
            _set_function(modules, reserved, 6, i, i % 2 == 0)
    _draw_format(modules, reserved, mask)
    return modules, reserved


def _place_data(modules, reserved, codewords: list[int], mask: int) -> None:
    bits = []
    for b in codewords:
        for i in range(7, -1, -1):
            bits.append((b >> i) & 1)
    size = len(modules)
    bit_index = 0
    upward = True
    right = size - 1
    while right > 0:
        if right == 6:
            right -= 1
        for vert in range(size):
            y = size - 1 - vert if upward else vert
            for j in range(2):
                x = right - j
                if reserved[y][x]:
                    continue
                dark = bit_index < len(bits) and bits[bit_index] == 1
                bit_index += 1
                if _mask_bit(mask, x, y):
                    dark = not dark
                modules[y][x] = dark
        upward = not upward
        right -= 2


def _penalty(modules) -> int:
    size = len(modules)
    penalty = 0
    for y in range(size):
        run_color = modules[y][0]
        run_len = 1
        for x in range(1, size):
            if modules[y][x] == run_color:
                run_len += 1
            else:
                if run_len >= 5:
                    penalty += 3 + run_len - 5
                run_color = modules[y][x]
                run_len = 1
        if run_len >= 5:
            penalty += 3 + run_len - 5
    for x in range(size):
        run_color = modules[0][x]
        run_len = 1
        for y in range(1, size):
            if modules[y][x] == run_color:
                run_len += 1
            else:
                if run_len >= 5:
                    penalty += 3 + run_len - 5
                run_color = modules[y][x]
                run_len = 1
        if run_len >= 5:
            penalty += 3 + run_len - 5
    for y in range(size - 1):
        for x in range(size - 1):
            color = modules[y][x]
            if modules[y][x + 1] == color and modules[y + 1][x] == color and modules[y + 1][x + 1] == color:
                penalty += 3
    patterns = ([1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1])
    for y in range(size):
        row = [1 if modules[y][x] else 0 for x in range(size)]
        for x in range(size - 10):
            if row[x:x + 11] in patterns:
                penalty += 40
    for x in range(size):
        col = [1 if modules[y][x] else 0 for y in range(size)]
        for y in range(size - 10):
            if col[y:y + 11] in patterns:
                penalty += 40
    dark = sum(1 for row in modules for value in row if value)
    total = size * size
    penalty += (abs(dark * 20 - total * 10) // total) * 10
    return penalty


def _matrix_for_text(text: str):
    data = _encode_bytes(text, 80)
    codewords = data + _rs_remainder(data, 20)
    best = None
    best_score = None
    for mask in range(8):
        modules, reserved = _base_matrix(mask)
        _place_data(modules, reserved, codewords, mask)
        score = _penalty(modules)
        if best_score is None or score < best_score:
            best = modules
            best_score = score
    return best


def qr_svg(text: str, *, scale: int = 6, border: int = 4) -> str:
    modules = _matrix_for_text(text)
    size = len(modules)
    full = size + border * 2
    dim = full * scale
    rects = []
    for y, row in enumerate(modules):
        for x, dark in enumerate(row):
            if dark:
                rects.append(
                    f'<rect x="{(x + border) * scale}" y="{(y + border) * scale}" width="{scale}" height="{scale}"/>'
                )
    title = escape(text)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {dim} {dim}" '
        f'width="{dim}" height="{dim}" role="img" aria-label="{title}" shape-rendering="crispEdges">'
        f'<rect width="100%" height="100%" fill="#fff"/>'
        f'<g fill="#000">{"".join(rects)}</g>'
        f'</svg>'
    )
