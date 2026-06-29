import React from 'react';
import { useI18n } from '@ticash/i18n';
import { ComingSoon } from '@/features/ComingSoon';

export default function Activity() {
  const { t: tr } = useI18n();
  return <ComingSoon title={tr('tabs.activity')} icon="receipt-outline" />;
}
