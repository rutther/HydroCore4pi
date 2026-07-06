// 文件：ui/js/dom.js
// 职责：DOM 小工具（减少重复代码）

export function $(sel, root = document){
  return root.querySelector(sel);
}
export function $all(sel, root = document){
  return Array.from(root.querySelectorAll(sel));
}

export function onKeyActivate(el, fn){
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  });
}
