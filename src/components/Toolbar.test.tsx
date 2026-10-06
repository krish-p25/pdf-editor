import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Toolbar } from './Toolbar';

afterEach(cleanup);

const setup = (panels: { pagesOpen?: boolean; settingsOpen?: boolean } = {}) => {
  const onExport = vi.fn();
  const onExportImages = vi.fn();
  const onTogglePages = vi.fn();
  const onToggleSettings = vi.fn();
  render(
    <Toolbar
      onExport={onExport}
      onExportImages={onExportImages}
      exporting={false}
      onCloseDoc={vi.fn()}
      onInsertImage={vi.fn()}
      pagesOpen={panels.pagesOpen ?? true}
      onTogglePages={onTogglePages}
      settingsOpen={panels.settingsOpen ?? true}
      onToggleSettings={onToggleSettings}
    />,
  );
  return { onExport, onExportImages, onTogglePages, onToggleSettings };
};

describe('export menu', () => {
  it('still exports a PDF from the main button', () => {
    const { onExport } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('is closed until asked for', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Export images' })).toBeNull();
  });

  it('exports PNG at 150 DPI by default', () => {
    const { onExportImages } = setup();
    fireEvent.click(screen.getByLabelText('More export options'));
    fireEvent.click(screen.getByRole('button', { name: 'Export images' }));
    expect(onExportImages).toHaveBeenCalledWith('png', 150);
  });

  it('passes the chosen format and resolution', () => {
    const { onExportImages } = setup();
    fireEvent.click(screen.getByLabelText('More export options'));
    fireEvent.click(screen.getByRole('button', { name: 'JPEG' }));
    fireEvent.click(screen.getByRole('button', { name: '300 DPI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export images' }));
    expect(onExportImages).toHaveBeenCalledWith('jpeg', 300);
  });

  it('closes once an export starts', () => {
    setup();
    fireEvent.click(screen.getByLabelText('More export options'));
    fireEvent.click(screen.getByRole('button', { name: 'Export images' }));
    expect(screen.queryByRole('button', { name: 'Export images' })).toBeNull();
  });

  it('closes on a click elsewhere', () => {
    setup();
    fireEvent.click(screen.getByLabelText('More export options'));
    // mousedown rather than pointerdown: jsdom has no PointerEvent.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Export images' })).toBeNull();
  });
});

describe('panel toggles', () => {
  it('hides an open pages panel', () => {
    const { onTogglePages } = setup({ pagesOpen: true });
    const toggle = screen.getByRole('button', { name: 'Hide pages' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(onTogglePages).toHaveBeenCalledOnce();
  });

  it('offers to show a closed settings panel', () => {
    const { onToggleSettings } = setup({ settingsOpen: false });
    const toggle = screen.getByRole('button', { name: 'Show settings' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggleSettings).toHaveBeenCalledOnce();
  });

  it('keeps Export outside the scrolling strip, so its menu is never clipped', () => {
    setup();
    const exportButton = screen.getByRole('button', { name: 'Export PDF' });
    const strip = screen.getByRole('button', { name: 'Back to documents' }).parentElement!;
    expect(strip.className).toContain('overflow-x-auto');
    expect(strip.contains(exportButton)).toBe(false);
  });
});
