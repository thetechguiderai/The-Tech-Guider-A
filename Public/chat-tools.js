(() => {
  const menu = document.querySelector("#featureMenu");
  const toggle = document.querySelector("#toolMenuBtn");
  const input = document.querySelector("#composerInput");
  if (!menu || !toggle || !input) return;
  const closeMenu = () => {
    menu.classList.remove("is-open");
    toggle.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
  };
  toggle.addEventListener("click", () => {
    const open = !menu.classList.contains("is-open");
    menu.classList.toggle("is-open", open);
    toggle.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-hidden", String(!open));
  });
  menu.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      menu.querySelectorAll("[data-tool]").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      closeMenu();
      input.value = tool + ": " + input.value;
      input.focus();
      input.dispatchEvent(new Event("input"));
    });
  });
  menu.querySelector("#imageBtn")?.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
  });
})();
