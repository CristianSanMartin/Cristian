"""Genera las poses de GSTin reutilizando defs, cuerpo y gorro de gstin-celebracion.svg.

Proporciones fijas (unidades del viewBox 640x900), pensadas para rigging 3D:
  cuerpo/logo: centro (320,430), radio 212 · hombros (150,390) y (490,390)
  brazo: 100 + 100 (hombro-codo-muñeca) · cadera (268,612) y (372,612)
  pierna: ~90 + ~90 (cadera-rodilla-tobillo)
uso: python3 poses.py  -> escribe gstin-<pose>.svg junto a este archivo
"""
import math
import re
from pathlib import Path

HERE = Path(__file__).parent
BASE = (HERE / "gstin-celebracion.svg").read_text()
DEFS = re.search(r"<defs>(.*?)</defs>", BASE, re.S).group(1)
BODY = BASE[BASE.index("    <!-- body:"):BASE.index("  </g>\n</svg>")]

INK = "#1E1B18"
SUIT = "#EFE6D2"
SUIT_LINE = "#D8CDB8"
YELLOW = "#F5C518"

EXTRA_DEFS = f"""
    <g id="fist">
      <!-- closed glove, knuckles toward +y, centred (0,0) -->
      <rect x="-30" y="-28" width="60" height="56" rx="20" fill="#FFFFFF" stroke="{INK}" stroke-width="5"/>
      <path d="M-8 -12 h30 M-8 2 h30 M-8 16 h26" stroke="#D9D4CC" stroke-width="3" stroke-linecap="round"/>
    </g>
    <g id="thumbsup">
      <use href="#fist"/>
      <rect x="-30" y="-74" width="22" height="58" rx="11" fill="#FFFFFF" stroke="{INK}" stroke-width="5"/>
    </g>
    <g id="point">
      <!-- index finger toward +x, thumb up: reads as "look here" -->
      <rect x="10" y="-24" width="72" height="22" rx="11" fill="#FFFFFF" stroke="{INK}" stroke-width="5"/>
      <use href="#fist"/>
      <rect x="-26" y="-66" width="22" height="48" rx="11" fill="#FFFFFF" stroke="{INK}" stroke-width="5" transform="rotate(-12 -15 -20)"/>
    </g>
    <path id="heart" d="M0 12 C-26 -6 -22 -30 -8 -30 C-2 -30 0 -24 0 -22 C0 -24 2 -30 8 -30 C22 -30 26 -6 0 12 Z"/>
"""


def arm(s, e, w):
    d = f"M{s[0]} {s[1]} Q{e[0]} {e[1]} {w[0]} {w[1]}"
    return (f'      <path d="{d}" stroke="{INK}" stroke-width="58"/>\n'
            f'      <path d="{d}" stroke="{SUIT}" stroke-width="48"/>\n')


def cuff(e, w):
    # cuff sits on the wrist, perpendicular to the forearm
    ang = math.degrees(math.atan2(w[1] - e[1], w[0] - e[0])) + 90
    return f'    <use href="#cuff" transform="translate({w[0]} {w[1]}) rotate({ang:.0f})"/>\n'


def leg(h, k, a):
    d = f"M{h[0]} {h[1]} Q{k[0]} {k[1]} {a[0]} {a[1]}"
    return (f'      <path d="{d}" stroke="{INK}" stroke-width="58"/>\n'
            f'      <path d="{d}" stroke="{SUIT}" stroke-width="48"/>\n')


def standing(lk=(262, 705), la=(258, 784), rk=(378, 705), ra=(382, 784), lfoot=(250, 822), rfoot=(390, 822)):
    out = '    <g fill="none" stroke-linecap="round" stroke-linejoin="round">\n'
    out += leg((268, 612), lk, la) + leg((372, 612), rk, ra) + "    </g>\n"
    out += f'    <use href="#sock" transform="translate({la[0]} {la[1] + 12})"/>\n'
    out += f'    <use href="#sock" transform="translate({ra[0]} {ra[1] + 12})"/>\n'
    out += f'    <use href="#shoe" transform="translate({lfoot[0]} {lfoot[1]}) scale(-1 1)"/>\n'
    out += f'    <use href="#shoe" transform="translate({rfoot[0]} {rfoot[1]})"/>\n'
    return out


def compose(behind, legs, arms, front, fx=""):
    arms_svg = '    <g fill="none" stroke-linecap="round" stroke-linejoin="round">\n'
    cuffs = ""
    for s, e, w in arms:
        arms_svg += arm(s, e, w)
        cuffs += cuff(e, w)
    arms_svg += "    </g>\n"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 640 900" width="640" height="900">
  <defs>{DEFS}{EXTRA_DEFS}  </defs>
{fx}
  <g filter="url(#sticker)">
{behind}{legs}{arms_svg}{cuffs}{BODY}{front}  </g>
</svg>
"""


SL, SR = (150, 390), (490, 390)
POSES = {}

# 1. Hoy llega un abono: pulgar arriba + moneda en alto
POSES["abono-hoy"] = compose(
    behind="",
    legs=standing(),
    arms=[(SL, (92, 330), (96, 250)), (SR, (548, 330), (548, 250))],
    front=f"""    <use href="#thumbsup" transform="translate(98 214) rotate(-8)"/>
    <g transform="translate(552 150)">
      <circle r="52" fill="#F2B705" stroke="{INK}" stroke-width="5"/>
      <circle r="40" fill="{YELLOW}" stroke="#D9A800" stroke-width="4"/>
      <text y="17" text-anchor="middle" font-family="Inter" font-weight="900" font-size="50" fill="#B58900">$</text>
    </g>
    <use href="#fist" transform="translate(548 218) rotate(180)"/>
""",
    fx=f"""  <g fill="{YELLOW}">
    <path d="M470 70 l6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6z"/>
    <path d="M622 110 l4 11 11 4 -11 4 -4 11 -4 -11 -11 -4 11 -4z"/>
    <path d="M40 140 l4 11 11 4 -11 4 -4 11 -4 -11 -11 -4 11 -4z" fill="#FFFFFF"/>
  </g>""",
)

# 2. Abono atrasado: reloj despertador en la mano, rascándose el gorro, rodillas juntas
POSES["abono-atrasado"] = compose(
    behind="",
    legs=standing(lk=(296, 702), la=(262, 784), rk=(344, 702), ra=(378, 784)),
    arms=[(SL, (82, 360), (84, 280)), (SR, (570, 300), (500, 236))],
    front=f"""    <g transform="translate(80 196) rotate(-10)">
      <g stroke="{INK}" stroke-width="5">
        <path d="M-42 -40 a20 20 0 0 1 28 -16 Z" fill="{YELLOW}"/>
        <path d="M42 -40 a20 20 0 0 0 -28 -16 Z" fill="{YELLOW}"/>
        <path d="M-30 46 l-12 14 M30 46 l12 14" stroke-linecap="round"/>
        <circle r="54" fill="{INK}"/>
        <circle r="44" fill="#FFFFFF"/>
      </g>
      <path d="M0 0 V-30 M0 0 L22 10" stroke="{INK}" stroke-width="6" stroke-linecap="round"/>
      <circle r="5" fill="#E63946"/>
    </g>
    <use href="#fist" transform="translate(84 262) rotate(180)"/>
    <use href="#glove" transform="translate(478 214) rotate(-50) scale(-1 1)"/>
""",
    fx=f"""  <g stroke="{YELLOW}" stroke-width="6" stroke-linecap="round" fill="none">
    <path d="M18 112 q-10 20 0 40"/><path d="M146 92 q14 18 4 40"/>
  </g>
  <g fill="#8EC5FF" stroke="{INK}" stroke-width="4">
    <path d="M560 120 q14 22 0 30 q-14 -8 0 -30z"/>
    <path d="M598 160 q10 16 0 22 q-10 -6 0 -22z"/>
  </g>""",
)

# 3. Todo al día: saludando con una mano, sosteniendo un corazón en la otra
POSES["todo-al-dia"] = compose(
    behind="",
    legs=standing(lk=(262, 705), la=(250, 784), rk=(392, 700), ra=(410, 780), lfoot=(242, 822), rfoot=(420, 818)),
    arms=[(SL, (80, 320), (100, 236)), (SR, (580, 470), (566, 400))],
    front=f"""    <use href="#glove" transform="translate(106 200) rotate(-12)"/>
    <use href="#heart" transform="translate(568 318) scale(2.2)" fill="#E63946" stroke="{INK}" stroke-width="2.4"/>
    <use href="#fist" transform="translate(566 372) rotate(180)"/>
""",
    fx=f"""  <g stroke="{YELLOW}" stroke-width="6" stroke-linecap="round" fill="none">
    <path d="M30 130 q-14 30 0 60"/><path d="M178 120 q14 30 0 60"/>
  </g>
  <use href="#heart" transform="translate(490 150) scale(0.8)" fill="{YELLOW}" stroke="{INK}" stroke-width="4"/>
  <use href="#heart" transform="translate(620 220) scale(0.6)" fill="#FFFFFF" stroke="{INK}" stroke-width="4"/>""",
)

# 5. Aviso / recordatorio: señala hacia arriba a la derecha, mano en la cadera
POSES["aviso"] = compose(
    behind="",
    legs=standing(rk=(400, 700), ra=(428, 782), rfoot=(438, 820)),
    arms=[(SL, (64, 470), (112, 536)), (SR, (566, 338), (566, 252))],
    front=f"""    <use href="#fist" transform="translate(120 548) rotate(60)"/>
    <use href="#point" transform="translate(566 230) rotate(-38)"/>
""",
    fx=f"""  <g stroke="{YELLOW}" stroke-width="7" stroke-linecap="round">
    <path d="M618 128 l10 -22"/><path d="M596 112 l-2 -24"/><path d="M632 150 l6 -4"/>
  </g>
  <g transform="translate(520 80)">
    <circle r="34" fill="{YELLOW}" stroke="{INK}" stroke-width="5"/>
    <text y="19" text-anchor="middle" font-family="Inter" font-weight="900" font-size="54" fill="{INK}">!</text>
  </g>""",
)

# 6. Torneo: trofeo en alto y carta en la otra mano
POSES["torneo"] = compose(
    behind="",
    legs=standing(),
    arms=[(SL, (86, 330), (96, 248)), (SR, (570, 440), (580, 360))],
    front=f"""    <g transform="translate(96 150)" stroke="{INK}" stroke-width="5" stroke-linejoin="round">
      <path d="M-30 -50 h60 v18 q0 40 -30 46 q-30 -6 -30 -46 z" fill="{YELLOW}"/>
      <path d="M-30 -40 q-26 0 -22 20 q4 16 24 14 M30 -40 q26 0 22 20 q-4 16 -24 14" fill="none"/>
      <rect x="-8" y="14" width="16" height="22" fill="#F2B705"/>
      <rect x="-26" y="36" width="52" height="16" rx="3" fill="{INK}"/>
      <path d="M0 -36 l5 10 11 2 -8 8 2 11 -10 -5 -10 5 2 -11 -8 -8 11 -2 z" fill="#FFFFFF" stroke="none"/>
    </g>
    <use href="#fist" transform="translate(96 228) rotate(180)"/>
    <g transform="translate(586 286) rotate(12)" stroke="{INK}" stroke-width="5" stroke-linejoin="round">
      <rect x="-38" y="-54" width="76" height="106" rx="7" fill="{YELLOW}"/>
      <rect x="-30" y="-46" width="60" height="44" rx="3" fill="#3A86FF"/>
      <path d="M0 -38 l-12 18 h10 l-4 14 16 -20 h-10 z" fill="#FFFFFF" stroke-width="3"/>
      <path d="M-24 10 h48 M-24 22 h36 M-24 34 h42" stroke-width="4" stroke-linecap="round"/>
    </g>
    <use href="#fist" transform="translate(580 346) rotate(170)"/>
""",
    fx=f"""  <g fill="{YELLOW}">
    <path d="M30 60 l5 13 13 5 -13 5 -5 13 -5 -13 -13 -5 13 -5z"/>
    <path d="M168 84 l4 11 11 4 -11 4 -4 11 -4 -11 -11 -4 11 -4z" fill="#FFFFFF"/>
    <path d="M520 170 l4 11 11 4 -11 4 -4 11 -4 -11 -11 -4 11 -4z"/>
  </g>""",
)

if __name__ == "__main__":
    for name, svg in POSES.items():
        (HERE / f"gstin-{name}.svg").write_text(svg)
        print("wrote", name)
