/**
 * 키보드 입력 + IME composition 처리
 */

let currentText = '';
let composing = false;

export function initInputHandler(inputElement, onChange) {
  inputElement.addEventListener('compositionstart', () => {
    composing = true;
  });

  inputElement.addEventListener('compositionend', (e) => {
    composing = false;
    currentText = e.target.value;
    onChange(currentText);
  });

  inputElement.addEventListener('input', (e) => {
    currentText = e.target.value;
    onChange(currentText);
  });
}

export function getCurrentText() {
  return currentText;
}
