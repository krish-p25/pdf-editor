import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SidePanel } from './SidePanel';

afterEach(cleanup);

const panel = (props: { open: boolean; narrow: boolean; side?: 'left' | 'right' }) => {
  const onClose = vi.fn();
  render(
    <SidePanel side={props.side ?? 'left'} open={props.open} narrow={props.narrow} onClose={onClose} label="Pages">
      <div>contents</div>
    </SidePanel>,
  );
  return { onClose };
};

describe('SidePanel on a wide screen', () => {
  it('sits in the layout when open, with no drawer chrome', () => {
    panel({ open: true, narrow: false });
    expect(screen.getByText('contents')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is removed entirely when collapsed, giving the page the room', () => {
    panel({ open: false, narrow: false });
    expect(screen.queryByText('contents')).toBeNull();
  });
});

describe('SidePanel on a phone', () => {
  it('slides over the page as a drawer when open', () => {
    panel({ open: true, narrow: true });
    expect(screen.getByRole('dialog', { name: 'Pages' }).className).toContain('translate-x-0');
  });

  it('stays mounted but off-screen and inert when closed', () => {
    panel({ open: false, narrow: true });
    const drawer = screen.getByRole('dialog', { hidden: true });
    expect(drawer.className).toContain('-translate-x-full');
    expect(drawer.hasAttribute('inert')).toBe(true);
  });

  it('slides the right-hand drawer off to the right', () => {
    panel({ open: false, narrow: true, side: 'right' });
    expect(screen.getByRole('dialog', { hidden: true }).className).toMatch(/(^| )translate-x-full/);
  });

  it('closes when the backdrop is tapped', () => {
    const { onClose } = panel({ open: true, narrow: true });
    fireEvent.click(screen.getByTestId('left-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from its own close button', () => {
    const { onClose } = panel({ open: true, narrow: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close pages' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has no backdrop while closed, so the page underneath is usable', () => {
    panel({ open: false, narrow: true });
    expect(screen.queryByTestId('left-backdrop')).toBeNull();
  });
});
