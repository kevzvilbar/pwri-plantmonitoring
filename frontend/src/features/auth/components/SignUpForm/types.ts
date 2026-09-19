export interface OperatorEntry {
  username: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  suffix: string;
}

export const blankOperator = (): OperatorEntry => ({
  username: '', first_name: '', last_name: '', middle_name: '', suffix: '',
});

export type SignUpStep = 'designation' | 'count' | 'entries' | 'details' | 'plants' | 'confirm';
