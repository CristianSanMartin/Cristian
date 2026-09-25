function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('index')
    .setTitle('Revisión de Proformas')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}