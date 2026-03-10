/**
 * 키보드 입력 + IME composition 처리
 */

let currentText = '';

export function initInputHandler(inputElement, onChange) {
  inputElement.addEventListener('compositionend', (e) => {
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
