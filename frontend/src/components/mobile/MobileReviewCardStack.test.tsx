import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileReviewCardStack, type MobileReviewItem } from './MobileReviewCardStack';

const mockReviewItems: MobileReviewItem[] = [
  {
    id: 'req-1',
    entityName: 'Product Water Flow Meter #1',
    plantName: 'Central RO',
    sourceTable: 'Product Meters',
    operatorUsername: 'jdoe',
    datetimeStr: 'Today, 08:30 AM',
    originalValue: 1420.0,
    proposedValue: 1820.0,
    unit: 'm³',
    reasonText: 'Odometer roll misread first digit',
    flagReason: 'Sudden Spike (+400 m³)',
  },
  {
    id: 'req-2',
    entityName: 'Well 3 Extraction',
    plantName: 'North Field',
    sourceTable: 'Wells',
    operatorUsername: 'asmith',
    datetimeStr: 'Yesterday, 04:15 PM',
    originalValue: 950.0,
    proposedValue: 920.0,
    unit: 'm³',
    reasonText: 'Correction per flow log recheck',
  },
];

describe('MobileReviewCardStack', () => {
  it('renders pending decision count, asset details, and value variance', () => {
    const onApprove = vi.fn().mockResolvedValue(true);
    const onReject = vi.fn().mockResolvedValue(true);

    render(
      <MobileReviewCardStack
        items={mockReviewItems}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    expect(screen.getByText('2 Pending Decisions')).toBeInTheDocument();
    expect(screen.getByText('Product Water Flow Meter #1')).toBeInTheDocument();
    expect(screen.getByText('Central RO')).toBeInTheDocument();
    expect(screen.getByText('1,420 m³')).toBeInTheDocument();
    expect(screen.getByText('1,820 m³')).toBeInTheDocument();
    expect(screen.getByText('+400 m³')).toBeInTheDocument();
    expect(screen.getByText('"Odometer roll misread first digit"')).toBeInTheDocument();
  });

  it('handles approve action and advances to the next card', async () => {
    const onApprove = vi.fn().mockResolvedValue(true);
    const onReject = vi.fn().mockResolvedValue(true);

    render(
      <MobileReviewCardStack
        items={mockReviewItems}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    const approveBtn = screen.getByText('Approve Correction');
    fireEvent.click(approveBtn);

    expect(onApprove).toHaveBeenCalledWith(mockReviewItems[0]);
  });
});

