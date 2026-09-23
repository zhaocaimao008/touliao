import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Icon, { IconButton, iconForMessageType } from './Icon';
import registry from './icon-registry.json';
import paths from './icon-paths.json';

describe('Touliao semantic icons', () => {
  it('renders every registered icon with vector geometry and accessible decorative semantics', () => {
    for (const name of Object.keys(registry.icons)) {
      const html = renderToStaticMarkup(<Icon name={name} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('stroke-width="1.8"');
      expect(paths[registry.icons[name]].length).toBeGreaterThan(0);
    }
  });
  it('keeps audio routes, notification mute, and file attachment semantically distinct', () => {
    expect(new Set(['bluetooth', 'speaker', 'earpiece'].map(x => registry.icons[x])).size).toBe(3);
    expect(registry.icons.file).toBe('paperclip');
    expect(registry.icons.fileContent).toBe('file-text');
    expect(registry.icons.mute).not.toBe(registry.icons.speakerOff);
    expect(registry.icons.cameraSwitch).not.toBe(registry.icons.refresh);
  });
  it('fails loudly for an unknown glyph or arbitrary size instead of drawing a fallback family', () => {
    expect(() => renderToStaticMarkup(<Icon name="material-icon" />)).toThrow('Unregistered');
    expect(() => renderToStaticMarkup(<Icon name="search" size={23} />)).toThrow('Unregistered');
  });
  it('labels the click target and applies size/color tokens to the glyph', () => {
    const html = renderToStaticMarkup(<IconButton icon="delete" label="删除" tone="danger" />);
    expect(html).toContain('aria-label="删除"');
    expect(html).toContain('var(--icon-danger)');
    expect(html).toContain('var(--icon-md)');
  });
  it('uses registered glyphs for message types while preserving unknown-type rendering', () => {
    for (const type of ['text','image','voice','video','file','contact_card','red_packet','transfer','merged','call','unknown']) {
      expect(registry.icons[iconForMessageType(type)]).toBeTruthy();
    }
  });
});
