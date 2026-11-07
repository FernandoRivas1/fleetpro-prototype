"""Generate the side-view vehicle illustrations in frontend/public/vehicles/.

The seeded fleet (backend/seed.py) points each vehicle's main_photo_url at
one of these files, "/vehicles/{body}-{color}.svg". They are drawn rather
than photographed so the demo has no image-licensing questions and every
card looks consistent on the client tablet.

Run from the repo root:  python frontend/scripts/generate_vehicle_art.py
"""
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "vehicles"

# name -> (paint, darker shade for sills and outlines)
COLORS = {
    "white": ("#F4F5F7", "#C9CED6"),
    "silver": ("#BCC3CB", "#8E97A1"),
    "gray": ("#6B7682", "#4C5560"),
    "black": ("#2A2F37", "#14171C"),
    "red": ("#B3262E", "#7E1A20"),
    "blue": ("#2F4E8E", "#1F3563"),
}

# Each body: outline path, window path, pillar x positions, wheel centers,
# wheel radius, and where the head/tail lights sit.
BODIES = {
    "hatchback": {
        "body": "M112 292 L108 262 Q108 240 128 234 L190 222 Q214 218 232 206 L290 166 Q300 160 316 159 "
        "L450 158 Q476 158 490 172 L520 214 Q530 228 530 246 L532 280 Q532 292 520 292 Z",
        "windows": "M244 210 L296 172 Q304 167 316 167 L446 166 Q466 166 476 178 L502 210 Z",
        "pillars": [372, 470],
        "wheels": [205, 445],
        "wheel_r": 38,
        "ground": 292,
        "door_lines": [258, 372, 478],
        "headlight": "M110 246 Q112 238 124 236 L146 232 Q150 240 142 246 Z",
        "taillight": "M520 204 Q528 214 529 230 L520 230 Q516 218 512 206 Z",
        "rails": None,
    },
    "sedan": {
        "body": "M104 292 L100 264 Q100 244 122 238 L200 224 Q228 220 248 204 L300 168 Q312 160 330 160 "
        "L420 160 Q442 160 458 172 L498 210 L530 216 Q542 220 542 236 L544 280 Q544 292 532 292 Z",
        "windows": "M258 208 L306 174 Q314 168 330 168 L418 168 Q436 168 448 178 L482 208 Z",
        "pillars": [366],
        "wheels": [198, 452],
        "wheel_r": 38,
        "ground": 292,
        "door_lines": [262, 366, 474],
        "headlight": "M102 250 Q104 242 116 240 L140 236 Q144 244 136 250 Z",
        "taillight": "M532 220 Q540 224 541 238 L528 238 Q526 228 522 220 Z",
        "rails": None,
    },
    "suv": {
        "body": "M96 290 L94 248 Q94 226 116 220 L196 206 Q214 202 228 188 L262 146 Q270 136 286 136 "
        "L500 134 Q520 134 528 150 L540 200 Q546 214 546 232 L548 278 Q548 290 536 290 Z",
        "windows": "M240 190 L272 152 Q278 144 290 144 L494 143 Q508 143 514 156 L526 190 Z",
        "pillars": [352, 440],
        "wheels": [200, 462],
        "wheel_r": 42,
        "ground": 290,
        "door_lines": [250, 352, 446],
        "headlight": "M96 232 Q98 224 110 222 L136 218 Q140 228 132 234 Z",
        "taillight": "M532 160 Q540 176 542 204 L532 204 Q530 182 524 162 Z",
        "rails": (300, 500, 128),
    },
}


def wheel(cx: int, cy: int, r: int) -> str:
    spokes = "".join(
        f'<rect x="{cx - 2}" y="{cy - r * 0.6:.0f}" width="4" height="{r * 1.2:.0f}" rx="2" fill="#9AA3AD" '
        f'transform="rotate({angle} {cx} {cy})"/>'
        for angle in (0, 36, 72, 108, 144)
    )
    return (
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#1D2127"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{r * 0.66:.0f}" fill="#D5DAE0"/>'
        f"{spokes}"
        f'<circle cx="{cx}" cy="{cy}" r="{r * 0.2:.0f}" fill="#7C8590"/>'
    )


def render(body_name: str, color_name: str) -> str:
    b = BODIES[body_name]
    paint, shade = COLORS[color_name]
    ground, r = b["ground"], b["wheel_r"]
    wheel_y = ground - 2
    top = 128 if b["rails"] else 156

    wells = "".join(f'<circle cx="{x}" cy="{wheel_y}" r="{r + 7}" fill="#20252B"/>' for x in b["wheels"])
    pillars = "".join(f'<rect x="{x - 5}" y="{top}" width="10" height="90" fill="{paint}"/>' for x in b["pillars"])
    doors = "".join(
        f'<line x1="{x}" y1="{top + 56}" x2="{x}" y2="{ground - 22}" stroke="{shade}" stroke-width="2" opacity=".7"/>'
        for x in b["door_lines"]
    )
    handles = "".join(
        f'<rect x="{x + 18}" y="{top + 66}" width="22" height="5" rx="2.5" fill="{shade}"/>'
        for x in b["door_lines"][:2]
    )
    rails = ""
    if b["rails"]:
        x1, x2, y = b["rails"]
        rails = f'<rect x="{x1}" y="{y}" width="{x2 - x1}" height="6" rx="3" fill="#3A424C"/>'

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="{color_name} {body_name}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7F8FA"/><stop offset="1" stop-color="#E4E8ED"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4E5D6E"/><stop offset="1" stop-color="#232B35"/></linearGradient>
<radialGradient id="shadow"><stop offset="0" stop-color="#1D2127" stop-opacity=".35"/><stop offset="1" stop-color="#1D2127" stop-opacity="0"/></radialGradient>
<clipPath id="body"><path d="{b['body']}"/></clipPath>
</defs>
<rect width="640" height="400" fill="url(#bg)"/>
<ellipse cx="325" cy="{ground + 6}" rx="250" ry="22" fill="url(#shadow)"/>
{rails}
<path d="{b['body']}" fill="{paint}" stroke="{shade}" stroke-width="2"/>
<g clip-path="url(#body)">{wells}<rect x="0" y="{ground - 24}" width="640" height="40" fill="{shade}" opacity=".55"/></g>
<path d="{b['windows']}" fill="url(#glass)"/>
<g clip-path="url(#body)">{pillars}</g>
<path d="{b['body']}" fill="url(#sheen)"/>
{doors}{handles}
<path d="{b['headlight']}" fill="#FFF6D8" stroke="{shade}" stroke-width="1.5"/>
<path d="{b['taillight']}" fill="#D23A3A" stroke="#7E1A20" stroke-width="1.5"/>
{''.join(wheel(x, wheel_y, r) for x in b['wheels'])}
</svg>
"""


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for body_name in BODIES:
        for color_name in COLORS:
            (OUT_DIR / f"{body_name}-{color_name}.svg").write_text(render(body_name, color_name), encoding="utf-8")
    print(f"Wrote {len(BODIES) * len(COLORS)} files to {OUT_DIR}")


if __name__ == "__main__":
    main()
