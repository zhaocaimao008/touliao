import { expect, test, vi } from 'vitest';
import MultiSelectBar from './MultiSelectBar';
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
vi.mock('../hooks/useBatchRecall', () => ({ MAX_BATCH_RECALL: 20 }));
function nodes(root, predicate) {
  if (!root || typeof root !== 'object') return [];
  return [root, ...[root.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))].filter(predicate);
}
test('recall over 20 is disabled with an explanation but forwarding stays available', () => {
  const tree = MultiSelectBar.type({ selectedCount: 21 });
  const buttons = nodes(tree, n => n.type === 'button');
  expect(buttons[1].props.disabled).toBe(false); expect(buttons[2].props.disabled).toBe(true);
  expect(buttons[2].props['aria-describedby']).toBe('batch-recall-limit');
  expect(nodes(tree, n => n.props?.id === 'batch-recall-limit')).toHaveLength(1);
});
test('pending action retains focusable controls but blocks repeat clicks and Escape', () => {
  const onCancel = vi.fn(), onForward = vi.fn(), onDelete = vi.fn();
  const tree = MultiSelectBar.type({ selectedCount: 2, busy: true, phase: 'sending', onCancel, onForward, onDelete });
  nodes(tree, n => n.type === 'button').forEach(button => { expect(button.props['aria-disabled']).toBe(true); button.props.onClick(); });
  tree.props.onKeyDown({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
  expect(onCancel).not.toHaveBeenCalled(); expect(onForward).not.toHaveBeenCalled(); expect(onDelete).not.toHaveBeenCalled();
  expect(nodes(tree, n => n.props?.role === 'status')[0].props.children).toBe('multiSelect.recalling');
});
test('failure remains visible beside the still-available actions', () => {
  const tree = MultiSelectBar.type({ selectedCount: 2, error: 'Offline, retry' });
  expect(nodes(tree, n => n.props?.role === 'alert')[0].props.children).toBe('Offline, retry');
  expect(nodes(tree, n => n.type === 'button')[2].props.disabled).toBe(false);
});
