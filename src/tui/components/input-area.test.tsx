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
    let submittedValue = '';
    const onSubmitMock = (text: string) => {
      submittedValue = text;
    };

    const { stdin, unmount } = render(
      <InputArea onSubmit={onSubmitMock} disabled={false} />
    );

    // Simulate typing text character by character
    stdin.write('h');
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('e');
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('l');
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('l');
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('o');
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Then press Enter
    stdin.write('\r');

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify callback was called with correct text
    expect(submittedValue).toBe('hello');

    unmount();
  });

  it('clears input after submission', async () => {
    const onSubmit = () => {};

    const { stdin, lastFrame, unmount } = render(
      <InputArea onSubmit={onSubmit} disabled={false} />
    );

    // Type text character by character
    stdin.write('t');
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('e');
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('s');
    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('t');
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Then submit
    stdin.write('\r');

    await new Promise((resolve) => setTimeout(resolve, 100));

    // After submission, the input should be cleared
    const output = lastFrame();
    expect(output).toContain('>');
    // The input text should not be visible (it was cleared)
    expect(output).not.toContain('test');

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
