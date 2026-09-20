"""Gera os ícones PNG do Vesty Aí a partir das formas da marca.

Rodar apenas quando a identidade mudar:
    python gerar-icones.py
"""
from PIL import Image, ImageDraw

AMEIXA = (72, 44, 64)
MARFIM = (247, 243, 238)
ROSA = (207, 169, 162)
LADO = 1024  # desenha grande e reduz, para a borda sair suave


def desenhar() -> Image.Image:
    img = Image.new("RGBA", (LADO, LADO), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    e = LADO / 512  # escala a partir do SVG de 512
    d.rounded_rectangle([0, 0, LADO, LADO], radius=int(114 * e), fill=AMEIXA)

    # V principal, nas mesmas coordenadas do icone.svg
    d.polygon(
        [(132 * e, 150 * e), (206 * e, 150 * e), (256 * e, 302 * e),
         (306 * e, 150 * e), (380 * e, 150 * e), (294 * e, 386 * e), (218 * e, 386 * e)],
        fill=MARFIM,
    )
    # Dobra interna em rosa
    d.polygon(
        [(256 * e, 302 * e), (294 * e, 186 * e), (368 * e, 186 * e), (308 * e, 314 * e)],
        fill=ROSA,
    )
    return img


if __name__ == "__main__":
    base = desenhar()
    for tamanho in (180, 192, 512):
        base.resize((tamanho, tamanho), Image.LANCZOS).save(f"icone-{tamanho}.png")
        print(f"icone-{tamanho}.png gerado")
