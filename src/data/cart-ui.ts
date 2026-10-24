import { getItem, lessonsForItem } from '../../functions/_lib/prices';

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function chooseTimesHtml(id: string): string {
  const item = getItem(id);
  if (!item || !lessonsForItem(item.id)) throw new Error(`Unknown lesson item: ${id}`);
  const href = `/book/?package=${encodeURIComponent(item.id)}`;
  return `<a class="sss-btn" href="${href}">Choose times</a>`;
}

/** Quantity control and Add to cart, beside an existing Pay link. */
export function cartAddHtml(id: string): string {
  const item = getItem(id);
  if (!item || !item.clientOrderable) throw new Error(`Unknown cart item: ${id}`);
  const safeId = escapeAttr(item.id);
  return `<span class="sss-cart-add" data-cart-id="${safeId}"><label class="sss-qty">Qty <input type="number" min="${item.minQty}" max="${item.maxQty}" value="1" inputmode="numeric" data-cart-qty aria-label="Quantity for ${escapeAttr(item.name)}"></label> <button type="button" class="sss-btn" data-cart-add>Add to cart</button></span>`;
}
