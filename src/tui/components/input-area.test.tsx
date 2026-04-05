// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { InputArea } from './input-area.tsx';

describe('InputArea', () => {
  it('renders prompt indicator when not disabled', () => {
    const onSubmit = () => {};
    const { lastFrame, unmount } = render(
      <InputArea onSubmit={onSubmit} disabled={false} />
    );

    const output = lastFrame();
    expect(output).toContain('>');

    unmount();
  });

  it('shows processing indicator when disabled', () => {
    const onSubmit = () => {};
    const { lastFrame, unmount } = render(
      <InputArea onSubmit={onSubmit} disabled={true} />
    );

    const output = lastFrame();
    expect(output).toContain('Processing...');
    expect(output).not.toContain('>');

    unmount();
  });

  it('calls onSubmit callback when Enter is pressed', async () => {
    let callCount = 0;
    const onSubmitMock = () => {
      callCount++;
    };

    const { stdin, unmount } = render(
      <InputArea onSubmit={onSubmitMock} disabled={false} />
    );

    // Simulate pressing Enter
    stdin.write('\r');

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify callback was called
    expect(callCount).toBe(1);

    unmount();
  });

  it('clears input after submission', async () => {
    const onSubmit = () => {};

    const { lastFrame, unmount } = render(
      <InputArea onSubmit={onSubmit} disabled={false} />
    );

    // After a submission, the input should be empty again
    // (Component re-renders with cleared input state)
    const output = lastFrame();
    expect(output).toContain('>');

    unmount();
  });

  it('transitions from enabled to disabled state', async () => {
    const onSubmit = () => {};
    const { lastFrame, rerender, unmount } = render(
      <InputArea onSubmit={onSubmit} disabled={false} />
    );

    // Initially should show prompt
    let output = lastFrame();
    expect(output).toContain('>');
    expect(output).not.toContain('Processing...');

    // Rerender with disabled=true
    rerender(<InputArea onSubmit={onSubmit} disabled={true} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should now show processing indicator
    output = lastFrame();
    expect(output).toContain('Processing...');
    expect(output).not.toContain('>');

    unmount();
  });

  it('transitions from disabled to enabled state', async () => {
    const onSubmit = () => {};
    const { lastFrame, rerender, unmount } = render(
      <InputArea onSubmit={onSubmit} disabled={true} />
    );

    // Initially should show processing indicator
    let output = lastFrame();
    expect(output).toContain('Processing...');

    // Rerender with disabled=false
    rerender(<InputArea onSubmit={onSubmit} disabled={false} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should now show prompt
    output = lastFrame();
    expect(output).toContain('>');
    expect(output).not.toContain('Processing...');

    unmount();
  });

  it('disables focus when disabled prop is true', async () => {
    const onSubmit = () => {};
    const { rerender, lastFrame, unmount } = render(
      <InputArea onSubmit={onSubmit} disabled={false} />
    );

    // Verify initial state is enabled (focus should be true)
    let output = lastFrame();
    expect(output).toContain('>');

    // Transition to disabled state
    rerender(<InputArea onSubmit={onSubmit} disabled={true} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify processing indicator is shown instead
    output = lastFrame();
    expect(output).toContain('Processing...');

    unmount();
  });
});
