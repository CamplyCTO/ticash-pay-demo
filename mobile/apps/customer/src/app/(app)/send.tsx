import React from 'react';
import { useI18n } from '@ticash/i18n';
import { ComingSoon } from '@/features/ComingSoon';

export default function Send() {
  const { t: tr } = useI18n();
  return <ComingSoon title={tr('tabs.send')} icon="paper-plane-outline" />;
}
