/* Camera scan for Domashnie Zapasy. Uses only the browser's native BarcodeDetector. */
(() => {
  'use strict';
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix'];
  let active = false;
  function scan() {
    if (active) return Promise.reject(Error('Сканер уже открыт'));
    active = true;
    return new Promise((resolve, reject) => {
      let stream = null, timer = null, detector = null, closed = false;
      const dlg = document.createElement('dialog');
      dlg.className = 'barcode-dialog';
      dlg.innerHTML = '<div class="barcode-panel">' +
        '<h2>Сканировать товар</h2>' +
        '<p class="sub">Наведите камеру на полосатый штрихкод или квадратный Data Matrix. Поддерживаемые форматы зависят от телефона.</p>' +
        '<video autoplay muted playsinline aria-label="Изображение с камеры"></video>' +
        '<p class="barcode-status" role="status">Запуск камеры…</p>' +
        '<form class="barcode-manual"><label for="barcode-manual-code">Или введите номер штрихкода / GTIN</label>' +
        '<input id="barcode-manual-code" name="code" placeholder="Например, 4601234567890" autocomplete="off" />' +
        '<div class="actions"><button class="btn secondary" type="button" data-scan-cancel>Отмена</button>' +
        '<button class="btn primary" type="submit">Найти товар</button></div></form>' +
        '<p class="form-help">Внешний поиск использует только код товара (GTIN), без серийного номера маркировки и данных о запасах.</p></div>';
      document.body.append(dlg);
      const video = dlg.querySelector('video');
      const status = dlg.querySelector('.barcode-status');
      function finish(value, error) {
        if (closed) return;
        closed = true;
        active = false;
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach(track => track.stop());
        if (dlg.open) dlg.close();
        dlg.remove();
        if (error) reject(error);
        else resolve(value);
      }
      dlg.querySelector('[data-scan-cancel]').addEventListener('click', () => finish(null));
      dlg.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
      dlg.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const value = String(new FormData(e.currentTarget).get('code') || '').trim();
        if (!value) { status.textContent = 'Введите код товара.'; return; }
        finish(value);
      });
      dlg.showModal();
      async function loop() {
        if (closed) return;
        if (video.readyState >= 2) {
          try {
            const matches = await detector.detect(video);
            const match = matches.find(m => m.rawValue && FORMATS.includes(m.format));
            if (match) { finish(String(match.rawValue)); return; }
          } catch (error) {
            status.textContent = 'Ошибка распознавания. Можно ввести код вручную.';
            return;
          }
        }
        timer = setTimeout(loop, 200);
      }
      (async () => {
        if (!('BarcodeDetector' in window) || !window.BarcodeDetector.getSupportedFormats) {
          status.textContent = 'Этот браузер не поддерживает сканирование. Введите код вручную.';
          return;
        }
        let supported;
        try { supported = await window.BarcodeDetector.getSupportedFormats(); }
        catch (_) { status.textContent = 'Распознавание недоступно. Введите код вручную.'; return; }
        if (closed) return;
        const formats = FORMATS.filter(f => supported.includes(f));
        if (!formats.length) { status.textContent = 'Нет поддерживаемых форматов. Введите код вручную.'; return; }
        try { detector = new window.BarcodeDetector({ formats }); }
        catch (_) { status.textContent = 'Не удалось запустить распознавание. Введите код вручную.'; return; }
        if (!navigator.mediaDevices?.getUserMedia) {
          status.textContent = 'Доступ к камере недоступен. Введите код вручную.';
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
          });
          if (closed) { stream.getTracks().forEach(track => track.stop()); return; }
          video.srcObject = stream;
          await video.play();
          if (closed) return;
          status.textContent = formats.includes('data_matrix')
            ? 'Ищу EAN / UPC / Data Matrix…'
            : 'Ищу EAN / UPC. Data Matrix на этом устройстве не поддерживается.';
          loop();
        } catch (error) {
          if (stream) stream.getTracks().forEach(track => track.stop());
          status.textContent = error?.name === 'NotAllowedError'
            ? 'Нет разрешения на камеру. Разрешите доступ в настройках браузера или введите код.'
            : 'Камера недоступна. Введите код вручную.';
        }
      })().catch(error => { if (!closed) status.textContent = 'Сканер недоступен: ' + error.message; });
    });
  }
  window.PantryScanner = { scan };
})();
