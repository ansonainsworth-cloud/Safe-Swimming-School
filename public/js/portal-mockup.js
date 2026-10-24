(function () {
  document.querySelectorAll('[data-mock-form]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var panel = form.closest('[data-mock-panel]');
      var confirm = panel && panel.querySelector('[data-mock-confirm]');
      form.hidden = true;
      if (confirm) confirm.hidden = false;
    });
  });
})();
