import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Toolbar } from './Toolbar';

afterEach(cleanup);

const setup = () => {
  const onExport = vi.fn();
  const onExportImages = vi.fn();
  render(
    <Toolbar
      onExport={onExport}
      onExportImages={onExportImages}
      exporting={false}
      onCloseDoc={vi.fn()}
      onInsertImage={vi.fn()}
    />,
  );
  return { onExport, onExportImages };
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
