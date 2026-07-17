import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, EmptyState, Row, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { formatMoneyParts } from '@ticash/api-client';
import { useI18n } from '@ticash/i18n';
import { messageForError, useApproveCashout, useCashoutPending, useRejectCashout } from '@ticash/core';

/** Customer approves/rejects agent-initiated withdrawals. Money leaves the wallet
 *  ONLY after an explicit approval here — the security control Jean asked for. */
export function CashoutScreen() {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const pending = useCashoutPending();
  const approve = useApproveCashout();
  const reject = useRejectCashout();
  const rows = pending.data ?? [];
  const busy = approve.isPending || reject.isPending;

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginTop: t.spacing(3), marginBottom: t.spacing(2) }}>Aprovar retiradas</Text>
      <Text variant="body" color="textMuted" style={{ marginBottom: t.spacing(5) }}>Um agente só consegue tirar dinheiro da sua conta se você aprovar aqui. Nada é debitado sem a sua confirmação.</Text>
      {pending.isLoading ? (
        <Text variant="body" color="textMuted" center>{tr('common.loading')}</Text>
      ) : rows.length === 0 ? (
        <Card padded={false} style={{ paddingHorizontal: t.spacing(4) }}>
          <EmptyState title="Nenhuma retirada pendente" icon={<Ionicons name="shield-checkmark-outline" size={28} color={t.colors.primary} />} />
        </Card>
      ) : (
        <View style={{ gap: t.spacing(3) }}>
          {rows.map((r) => {
            const p = formatMoneyParts(r.amountMinor, r.currency);
            return (
              <Card key={r.id} style={{ gap: t.spacing(3) }}>
                <View>
                  <Text variant="caption" color="textMuted">Retirada solicitada por um agente</Text>
                  <Text variant="heading">{`${p.symbol} ${p.integer},${p.fraction} ${r.currency}`}</Text>
                  <Text variant="caption" color="textMuted">{`Agente: ${r.agentId} · ${r.createdAt.slice(0, 16).replace('T', ' ')}`}</Text>
                </View>
                <Row gap={3}>
                  <Button variant="secondary" title="Recusar" style={{ flex: 1 }} disabled={busy} onPress={() => reject.mutate(r.id, { onSuccess: () => toast.success('Retirada recusada'), onError: (e) => toast.error(messageForError(e, tr)) })} />
                  <Button title="Aprovar" style={{ flex: 1 }} loading={approve.isPending} disabled={busy} onPress={() => approve.mutate(r.id, { onSuccess: () => toast.success('Retirada aprovada — valor debitado'), onError: (e) => toast.error(messageForError(e, tr)) })} />
                </Row>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
