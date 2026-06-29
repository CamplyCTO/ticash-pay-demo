import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Chip, Divider, Row, Screen, Skeleton, Text, useTheme, useToast, type ChipTone } from '@ticash/ui';
import { isCustomerMe } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { messageForError, useKycLimits, useKycStart, useMe } from '@ticash/core';

const STATUS_TONE: Record<string, ChipTone> = { approved: 'success', pending: 'warning', review: 'info', rejected: 'danger' };

export function KycScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const me = useMe();
  const limits = useKycLimits();
  const start = useKycStart();

  const kyc = me.data && isCustomerMe(me.data) ? me.data.kyc : null;
  const statusKey = (kyc?.status ?? 'pending') as 'approved' | 'pending' | 'review' | 'rejected';

  return (
    <Screen scroll footer={
      <Button
        title={tr('kyc.start')}
        loading={start.isPending}
        onPress={() => start.mutate(undefined, { onSuccess: () => toast.success(tr('kyc.started')), onError: (e) => toast.error(messageForError(e, tr)) })}
      />
    }>
      <Text variant="title" style={{ marginTop: t.spacing(3), marginBottom: t.spacing(5) }}>{tr('kyc.title')}</Text>

      <Card style={{ marginBottom: t.spacing(4) }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Text variant="label" color="textMuted">{tr('kyc.status')}</Text>
            <Text variant="heading" style={{ marginTop: 2 }}>{tr('profile.level')} {kyc?.level ?? 0}</Text>
          </View>
          <Chip label={tr(`kyc.${statusKey}`)} tone={STATUS_TONE[statusKey] ?? 'neutral'} />
        </Row>
      </Card>

      <Text variant="label" color="textMuted" style={{ marginBottom: t.spacing(2) }}>{tr('kyc.limits')}</Text>
      <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
        {limits.isLoading ? (
          <View style={{ paddingVertical: t.spacing(3), gap: t.spacing(2) }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={20} />)}</View>
        ) : (
          (limits.data ?? []).map((l, i, arr) => (
            <Row key={l.level} style={{ justifyContent: 'space-between', paddingVertical: t.spacing(3.5), borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: t.colors.divider }}>
              <Text variant="body" weight={l.level === (kyc?.level ?? 0) ? 'bold' : 'regular'}>{tr('profile.level')} {l.level}</Text>
              <Text variant="body" weight="semibold">R$ {l.cap.toLocaleString('pt-BR')} <Text variant="caption" color="textMuted">{tr('kyc.perTx')}</Text></Text>
            </Row>
          ))
        )}
      </Card>
    </Screen>
  );
}
