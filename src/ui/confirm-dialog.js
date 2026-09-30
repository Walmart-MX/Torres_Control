/**
 * ui/confirm-dialog.js
 * CONFIRM DIALOG - reemplazo Promise-based de confirm()/prompt()/alert()
 * nativos del navegador. Reutiliza el markup y las clases CSS de
 * .warn-modal-* (ver index.html, junto a #warnModalOverlay) - mismo
 * look & feel que el resto de la app (incluye la animacion de entrada
 * y el fondo con fade ya definidos ahi), cero CSS nuevo.
 *
 * Por que Promise-based en vez de callbacks: los call sites existentes
 * eran `if (!confirm('...')) return;` - con `await ConfirmDialog.confirm(...)`
 * la forma del codigo casi no cambia (mismo `if (!... ) return;`), solo
 * la funcion contenedora necesita ser `async`. confirm()/prompt() nativos
 * BLOQUEAN el hilo principal; este modal no bloquea nada - por eso las
 * llamadas ahora son asincronas.
 *
 * Contrato (mismo criterio "falsy = cancelado" que los nativos):
 *   ConfirmDialog.confirm({ title, body, confirmLabel, cancelLabel, danger })
 *     -> Promise<boolean>  (true = confirmo, false = cancelo/Escape/backdrop)
 *   ConfirmDialog.prompt({ title, body, placeholder, defaultValue, confirmLabel })
 *     -> Promise<string|null>  (string = valor, null = cancelo)
 *   ConfirmDialog.alertMsg({ title, body, confirmLabel })
 *     -> Promise<void>  (un solo boton, sin opcion de cancelar)
 *
 * Solo una instancia global del dialogo (un unico set de IDs en el DOM) -
 * si se llama de nuevo mientras uno esta abierto, el anterior se resuelve
 * como cancelado antes de abrir el nuevo (evita dos promesas colgadas
 * compitiendo por el mismo modal).
 *
 * Sin dependencias de otros modulos propios - _wire() se llama una sola
 * vez desde core/app.js durante el bootstrap.
 */

let _resolve  = null;
let _isPrompt = false;

function _els() {
  return {
    overlay: document.getElementById('confirmDialogOverlay'),
    icon:    document.getElementById('cdIcon'),
    title:   document.getElementById('cdTitle'),
    body:    document.getElementById('cdBody'),
    input:   document.getElementById('cdInput'),
    cancel:  document.getElementById('cdCancel'),
    confirm: document.getElementById('cdConfirm')
  };
}

function _settle(result) {
  const { overlay } = _els();
  overlay.classList.add('hidden');
  if (_resolve) { const r = _resolve; _resolve = null; r(result); }
}

function _open(opts, isPrompt) {
  const els = _els();

  const {
    title, body, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
    danger = false, icon = danger ? '!' : '?',
    placeholder = '', defaultValue = '', hideCancel = false
  } = opts;

  els.icon.textContent  = icon;
  els.title.textContent = title;
  els.body.innerHTML    = body || '';
  els.input.style.display = isPrompt ? '' : 'none';
  els.input.value       = defaultValue;
  els.input.placeholder = placeholder;
  els.confirm.textContent = confirmLabel;
  els.confirm.className   = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
  els.cancel.textContent  = cancelLabel;
  els.cancel.style.display = hideCancel ? 'none' : '';
  _isPrompt = isPrompt;
  els.overlay.classList.remove('hidden');
  if (isPrompt) setTimeout(() => els.input.focus(), 80);
}

/**
 * Si ya hay un dialogo pendiente sin resolver (llamada nueva encima de
 * una vieja), se cancela ANTES de pisar _resolve con el nuevo - aqui
 * es donde vivia el bug: antes se chequeaba esto DESPUES de que los
 * metodos de abajo ya hubieran asignado _resolve = resolve (el nuevo),
 * asi que _settle() terminaba auto-resolviendo la promesa recién creada
 * con el valor de "cancelado" al instante - el modal se veía en
 * pantalla pero ya había regresado null/false desde el primer frame,
 * antes de que el usuario alcanzara a escribir nada.
 */
function _cancelPending(cancelValue) {
  if (_resolve) {
    const old = _resolve;
    _resolve = null;
    _els().overlay.classList.add('hidden');
    old(cancelValue);
  }
}

export const ConfirmDialog = {
  confirm(opts) {
    _cancelPending(false);
    return new Promise(resolve => { _resolve = resolve; _open(opts, false); });
  },
  prompt(opts) {
    _cancelPending(null);
    return new Promise(resolve => { _resolve = resolve; _open(opts, true); });
  },
  alertMsg(opts) {
    _cancelPending(undefined);
    return new Promise(resolve => { _resolve = resolve; _open({ ...opts, hideCancel: true }, false); });
  },

  /** Wiring de eventos - llamar UNA sola vez desde core/app.js (bootstrap). */
  _wire() {
    const els = _els();
    els.cancel.addEventListener('click', () => _settle(_isPrompt ? null : false));
    els.confirm.addEventListener('click', () => _settle(_isPrompt ? els.input.value : true));
    els.overlay.addEventListener('click', e => {
      if (e.target === els.overlay) _settle(_isPrompt ? null : false);
    });
    els.input.addEventListener('keydown', e => { if (e.key === 'Enter') els.confirm.click(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !els.overlay.classList.contains('hidden')) {
        _settle(_isPrompt ? null : false);
      }
    });
  }
};
