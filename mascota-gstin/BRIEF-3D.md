# GSTin: brief para render 3D

Las ilustraciones de esta carpeta son la **guía de pose y proporciones**. Al pasarlas a 3D, sube siempre como referencia:

1. `fuente/logo.png`: el logo original. Va como **textura plana** sobre la cara frontal del disco, nunca redibujado por la IA.
2. La ilustración de la pose (`gstin-<pose>@2x.png`).
3. Una de las fotos 3D de referencia que ya tienes (la de los pulgares arriba es la mejor).

## Hoja de personaje (igual en todas las poses)

| Parte | Especificación |
|---|---|
| Cuerpo | Disco grueso (grosor ≈ 1/8 del diámetro), canto negro mate. Cara frontal = logo GS impreso plano, sin relieve que lo deforme. Siempre de frente o máximo 15° de giro. |
| "TCG" | Blanco con borde negro, centrado bajo "GS", dentro del círculo oscuro. Única adición al logo. |
| Cara | No tiene. El logo es la cara. Sin ojos ni boca. |
| Gorro | Jockey amarillo (#F5C518), ladeado ~12° hacia la derecha del espectador, visera hacia la derecha. Apoyado sobre el canto superior del disco. |
| Brazos | Traje de mascota de felpa color crema (#EFE6D2). Salen por detrás del disco a la altura del 40 % superior. Largo brazo ≈ diámetro del disco. |
| Manos | Guantes blancos de algodón estilo cartoon, 4 dedos, puño acanalado crema. |
| Piernas | Crema, salen por detrás del disco abajo. Largo pierna ≈ 0,85 × diámetro. |
| Calcetines | Amarillos acanalados. |
| Zapatillas | Blancas con puntera negra, suela blanca, cordones negros. |
| Material | Felpa/peluche suave en traje y guantes; disco tipo goma o PVC mate. |
| Salida | Fondo transparente, sin sombra en el piso, cuerpo completo centrado, vertical. |

## Prompt base (en inglés, funciona mejor en la mayoría de plataformas)

> 3D render of a plush mascot character, full body, centered, front view, isolated on a transparent background, no floor shadow. The body is a thick round disc whose entire front face is the attached GS logo printed flat and undistorted, with the word "TCG" in bold white letters with a black outline below "GS". No face, no eyes, no mouth. Yellow baseball cap slightly tilted to the right on top of the disc. Cream plush mascot-suit arms and legs coming out from behind the disc, white cartoon gloves with four fingers, yellow ribbed socks, white sneakers with black toe caps. Soft studio lighting, friendly gamer/collector vibe, Pixar-like toy quality. Keep the logo 100% identical to the reference image.

Agrega al final la línea de la pose:

| Archivo | Pose (agregar al prompt) |
|---|---|
| `gstin-celebracion` | Jumping in a star jump, both arms raised high with open hands, legs spread in the air, yellow, white, red and blue confetti around. |
| `gstin-abono-hoy` | Standing, left hand doing a thumbs up raised beside the head, right hand holding up a big shiny gold coin with a "$" sign, small sparkles. |
| `gstin-abono-atrasado` | Standing knock-kneed, nervous, left hand holding up a white alarm clock that is ringing (shake lines), right hand scratching the cap, two small blue sweat drops near the cap. Humorous, not sad. |
| `gstin-todo-al-dia` | Relaxed standing, left hand waving hello, right hand holding a big red heart beside the body, small floating hearts. |
| `gstin-aviso` | Standing with weight on one leg, left hand on the hip, right arm raised pointing up and to the right with the index finger ("look at this"), small yellow "!" speech badge. |
| `gstin-torneo` | Standing proudly, left hand raising a small gold trophy cup with a star, right hand holding up a trading card with a yellow border (generic card, no real Pokémon artwork). |

## Para que salgan consistentes

- Genera primero la **hoja de personaje** (frente, 3/4 y espalda) en una sola imagen y úsala de referencia para todas las poses.
- Si la plataforma permite "character reference" o "image weight", usa el mismo peso en las 6.
- Si la IA deforma el logo: genera la pose con un disco liso amarillo y negro, y pega `fuente/logo.png` encima en edición (Photoshop, Canva o Photopea). Así el logo queda perfecto siempre.
- Las manos nunca deben tapar "GS" ni "TCG".
- Exporta a 1000 px de alto y luego reduce a 500 px, para que se vea nítido a 150 px.
