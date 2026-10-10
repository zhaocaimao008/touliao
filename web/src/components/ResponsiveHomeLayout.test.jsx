import React, { useEffect, useState } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, test, vi } from 'vitest';
import ResponsiveHomeLayout from './ResponsiveHomeLayout';

let renderer;
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = null; });
function Draft({ name, onUnmount }) {
  const [value, setValue] = useState('');
  useEffect(() => () => onUnmount?.(), [onUnmount]);
  return <input aria-label={name} value={value} onChange={event => setValue(event.target.value)} />;
}
function shell(mobile, props = {}) {
  return <ResponsiveHomeLayout mobile={mobile} showChatArea chatOpen={false}
    sidebar={<button>Account</button>} navigation={<nav>Mobile navigation</nav>}
    header={<h1>{mobile ? 'Mobile' : 'Desktop'}</h1>}
    {...props} />;
}
test('panel draft and component identity survive desktop/mobile round trips', () => {
  const unmount = vi.fn(); const panel = <Draft name="Label draft" onUnmount={unmount} />;
  act(() => { renderer = create(shell(false, { children: panel })); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: 'Unsaved label' } }));
  for (const mobile of [true, false, true]) {
    act(() => renderer.update(shell(mobile, { children: panel })));
    expect(renderer.root.findByType('input').props.value).toBe('Unsaved label');
    expect(unmount).not.toHaveBeenCalled();
  }
});
test('conversation drafts remain mounted across responsive layout changes', () => {
  const unmount = vi.fn(); const chat = <Draft name="Message draft" onUnmount={unmount} />;
  act(() => { renderer = create(shell(false, { chatOpen: true, chat, children: <p>Conversations</p> })); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: 'Keep this message' } }));
  for (const mobile of [true, false]) {
    act(() => renderer.update(shell(mobile, { chatOpen: true, chat, children: <p>Conversations</p> })));
    expect(renderer.root.findByType('input').props.value).toBe('Keep this message');
    expect(unmount).not.toHaveBeenCalled();
  }
});
test('mobile conversation hides the retained panel and bottom navigation', () => {
  act(() => { renderer = create(shell(true, { chatOpen: true, children: <input aria-label="Panel" />, chat: <p>Messages</p> })); });
  expect(renderer.root.findByProps({ className: 'm-page' }).props.hidden).toBe(true);
  expect(renderer.root.findByProps({ className: 'm-chat-page' }).props.hidden).toBe(false);
  expect(renderer.root.findAllByType('nav')).toHaveLength(0);
  act(() => renderer.update(shell(false, { chatOpen: true, children: <input aria-label="Panel" />, chat: <p>Messages</p> })));
  expect(renderer.root.findByProps({ className: 'wc-panel' }).props.hidden).toBe(false);
});
test('returning from a mobile conversation restores its retained panel state', () => {
  const panel = <Draft name="Panel" />;
  act(() => { renderer = create(shell(true, { children: panel })); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: 'Selection' } }));
  act(() => renderer.update(shell(true, { children: panel, chatOpen: true, chat: <p>Messages</p> })));
  act(() => renderer.update(shell(true, { children: panel })));
  expect(renderer.root.findByType('input').props.value).toBe('Selection');
  expect(renderer.root.findByProps({ className: 'm-page' }).props.hidden).toBe(false);
});
test('an open overlay retains its input when the navigation layout changes', () => {
  const overlay = <React.Fragment key="home-overlays"><Draft name="Modal draft" /></React.Fragment>;
  act(() => { renderer = create(shell(true, { overlays: overlay })); });
  act(() => renderer.root.findByType('input').props.onChange({ target: { value: 'Group name' } }));
  act(() => renderer.update(shell(false, { overlays: overlay })));
  expect(renderer.root.findByType('input').props.value).toBe('Group name');
});
test('leaving the authenticated shell still disposes all retained state', () => {
  const unmount = vi.fn();
  act(() => { renderer = create(shell(true, { children: <Draft name="Label" onUnmount={unmount} /> })); });
  act(() => renderer.update(<p>Signed out</p>));
  expect(unmount).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType('input')).toHaveLength(0);
});
