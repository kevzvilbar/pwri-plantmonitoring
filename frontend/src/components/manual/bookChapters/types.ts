import type { ReactNode } from 'react';

export type BookChapter = {
  id: string;
  number: number;
  title: string;
  dek: string;
  body: ReactNode;
};

export type BookPart = {
  part: string;
  chapters: BookChapter[];
};
