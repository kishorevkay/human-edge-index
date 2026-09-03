// Code-native ATLAS logo: an animated isometric cube ("tesseract"), built off the
// real Atlas SkillTech University cube mark. Lives as a HUD glyph, not a character —
// CIVIS and the human reviewer are separate illustrated characters.
// States: "default" (blue) -> "correct" (green) -> "wrong" (red), driven by setTesseractState.

export function tesseractLogoHTML(size = 56) {
  return `
    <div class="tesseract" style="width:${size}px;height:${size}px" data-tesseract>
      <div class="tesseract-core"></div>
      <div class="tesseract-face"><i></i><i></i><i></i></div>
    </div>
  `;
}

export function setTesseractState(root, state) {
  const el = root.querySelector("[data-tesseract]");
  if (!el) return;
  el.classList.remove("is-correct", "is-wrong");
  if (state === "correct") el.classList.add("is-correct");
  if (state === "wrong") el.classList.add("is-wrong");
}
