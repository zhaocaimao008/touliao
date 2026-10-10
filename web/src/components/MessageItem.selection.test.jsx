import { expect, test, vi } from 'vitest';
import MessageItem from './MessageItem';

vi.mock('../utils/url', () => ({ mediaUrl: v => v, resolveMediaUrl: v => v, getThumbUrl: v => v, useMediaCredentials: () => {} }));
vi.mock('../utils/toast', () => ({ showToast: vi.fn() }));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
vi.mock('../hooks/useSwipe', () => ({ useSwipe: () => ({ swipeOffset: -72, swipeEnabled: true, swipeHandlers: {}, resetSwipe: vi.fn() }) }));
vi.mock('../utils/richText', () => ({ renderRichText: v => v, mentionsUser: () => false }));
vi.mock('../utils/imgDimCache', () => ({ getAspect: () => 1, rememberAspect: vi.fn() }));
vi.mock('./VoicePlayer', () => ({ default: () => null }));
vi.mock('./MergedMessageCard', () => ({ default: () => null }));

function nodes(root, predicate) {
  if (!root || typeof root !== 'object') return [];
  return [root, ...[root.props?.children].flat(Infinity).flatMap(child => nodes(child, predicate))].filter(predicate);
}
function render(type, multiSelect = true) {
  const callbacks = { toggleMsgSelect: vi.fn(), handleContextMenu: vi.fn(), cancelMultiSelect: vi.fn() };
  const msg = { id: 'fixture', type, content: type === 'text' ? 'Text with a link' : '{}', file_url: '/test.png', reactions: [{ emoji: '👍', count: 1, userIds: [] }], replyTo: { id: 'quoted', type: 'text', content: 'quoted' } };
  return { callbacks, msg, tree: MessageItem.type({ item: { msg, multiSelect, isMine: true, convType: 'private', members: [], groupSettings: {} }, cbRef: { current: callbacks } }) };
}
const event = values => ({ preventDefault: vi.fn(), stopPropagation: vi.fn(), ...values });

test.each(['text', 'image', 'video', 'voice', 'file', 'contact_card', 'red_packet', 'merged'])('%s selection captures activation before nested actions and removes nested tab targets', type => {
  const { tree, callbacks } = render(type);
  const click = event();
  tree.props.onClickCapture(click);
  expect(callbacks.toggleMsgSelect).toHaveBeenCalledExactlyOnceWith('fixture');
  expect(click.preventDefault).toHaveBeenCalledOnce();
  expect(click.stopPropagation).toHaveBeenCalledOnce();
  expect(tree.props.onClick).toBeUndefined();
  expect(tree.props.role).toBe('checkbox');
  expect(tree.props['aria-label']).toBeTruthy();
  expect(tree.props.style.transform).toBeUndefined();
  expect(nodes(tree, n => n.props?.className === 'wc-msg-body')[0].props.inert).toBe('');
  const context = event();
  tree.props.onContextMenuCapture(context);
  expect(context.stopPropagation).toHaveBeenCalledOnce();
  expect(callbacks.handleContextMenu).not.toHaveBeenCalled();
});

test.each(['Enter', ' '])('selection accepts one %j activation, ignores key repeat, and Escape cancels', key => {
  const { tree, callbacks } = render('image');
  tree.props.onKeyDownCapture(event({ key }));
  tree.props.onKeyDownCapture(event({ key, repeat: true }));
  expect(callbacks.toggleMsgSelect).toHaveBeenCalledExactlyOnceWith('fixture');
  tree.props.onKeyDownCapture(event({ key: 'Escape' }));
  expect(callbacks.cancelMultiSelect).toHaveBeenCalledOnce();
});

test('ordinary messages retain content interaction and expose keyboard context menus', () => {
  const { tree, callbacks, msg } = render('image', false);
  expect(tree.props.onClickCapture).toBeUndefined();
  expect(nodes(tree, n => n.props?.className === 'wc-msg-body')[0].props.inert).toBeUndefined();
  const bubble = nodes(tree, n => n.props?.['data-testid'] === 'msg-bubble-fixture')[0];
  expect(bubble.props.tabIndex).toBe(0);
  const key = event({ key: 'F10', shiftKey: true });
  bubble.props.onKeyDown(key);
  expect(callbacks.handleContextMenu).toHaveBeenCalledWith(key, msg);
  bubble.props.onKeyDown(event({ key: 'Enter' }));
  expect(callbacks.handleContextMenu).toHaveBeenCalledOnce();
});
