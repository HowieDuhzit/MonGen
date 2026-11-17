if (window.monGenInput) {
  document.body.classList.add("headless");
  void import("./gpu-smoke");
} else {
  void import("./editor");
}
