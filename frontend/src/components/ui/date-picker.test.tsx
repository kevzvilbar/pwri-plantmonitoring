import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DatePicker, DateRangePicker, DateTimePicker } from './date-picker';

afterEach(() => cleanup());

describe('DatePicker', () => {
  it('renders with placeholder and value formatted properly', () => {
    render(<DatePicker value="2026-09-02" placeholder="Pick a date" />);
    expect(screen.getByText('Sep 2, 2026')).toBeTruthy();
  });

  it('handles clearing when clear button is clicked', () => {
    const handleChange = vi.fn();
    render(<DatePicker value="2026-09-02" onChange={handleChange} clearable />);
    const clearBtn = screen.getByTitle('Clear date');
    fireEvent.click(clearBtn);
    expect(handleChange).toHaveBeenCalledWith('');
  });
});

describe('DateRangePicker', () => {
  it('renders single selected date or range correctly', () => {
    const { rerender } = render(<DateRangePicker from="2026-09-01" to="" />);
    expect(screen.getByText(/Sep 1, 2026 – …/)).toBeTruthy();

    rerender(<DateRangePicker from="2026-09-01" to="2026-09-05" />);
    expect(screen.getByText(/Sep 1, 2026 – Sep 5, 2026/)).toBeTruthy();
  });

  it('renders presets properly and allows selecting one', () => {
    const handleChange = vi.fn();
    render(<DateRangePicker from="" to="" onChange={handleChange} presets />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    const todayBtn = screen.getByRole('button', { name: 'Today' });
    fireEvent.click(todayBtn);
    expect(handleChange).toHaveBeenCalled();
  });
});

describe('DateTimePicker', () => {
  it('renders formatted date and time', () => {
    render(<DateTimePicker value="2026-09-02T14:30" />);
    expect(screen.getByText('Sep 2, 2026 14:30')).toBeTruthy();
  });

  it('does not emit onChange when time is adjusted if no date has been picked yet', () => {
    const handleChange = vi.fn();
    render(<DateTimePicker value="" onChange={handleChange} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    // Click 15-minute interval button before date is selected
    const interval15 = screen.getByRole('button', { name: ':15' });
    fireEvent.click(interval15);
    expect(handleChange).not.toHaveBeenCalled();
  });
});
