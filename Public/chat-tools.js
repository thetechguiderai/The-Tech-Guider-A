(() => {
  const menu = document.querySelector("#featureMenu");
  const toggle = document.querySelector("#toolMenuBtn");
  const input = document.querySelector("#composerInput");
  if (!menu || !toggle || !input) return;
  toggle.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  menu.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      menu.querySelectorAll("[data-tool]").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      menu.hidden = true;
      toggle.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      input.value = tool + ": " + input.value;
      input.focus();
      input.dispatchEvent(new Event("input"));
    });
  });
})();
