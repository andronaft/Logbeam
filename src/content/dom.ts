/**
 * The one way the viewer builds DOM: from nodes, never innerHTML, so it also works on pages that
 * enforce Trusted Types (GitHub, Google).
 */
export type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}
