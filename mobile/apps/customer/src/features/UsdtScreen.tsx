import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Divider, EmptyState, Input, Row, Screen, Text, useTheme, useToast } from '@ticash/ui';
import { formatMoneyParts, type P2POffer, type P2POrder } from '@ticash/api-client';
import {
  messageForError,
  useOpenP2POrder,
  useP2POffers,
  useP2POrders,
  useP2PPay,
  useDisputeP2POrder,
  useCancelP2POrder,
} from '@ticash/core';
import { useI18n } from '@ticash/i18n';

// NOTE: this WS-4 MVP screen uses literal PT copy (the primary market). FR/EN
// i18n keys + image-picker proof upload are a documented follow-up.

const money = (minor: string, ccy: 'USDT' | string) => {
  const p = formatMoneyParts(minor, ccy as never);
  const frac = ccy === 'USDT' ? p.fraction.slice(0, 2) : p.fraction;
  return `${p.symbol}${p.integer},${frac}`;
};

const STATUS_LABEL: Record<P2POrder['status'], string> = {
  created: 'Aguardando seu pagamento',
  payment_submitted: 'Aguardando o vendedor confirmar',
  released: 'Concluída — USDT recebido',
  cancelled: 'Cancelada',
  disputed: 'Em análise (central)',
};

export function UsdtScreen() {
  const t = useTheme();
  const [tab, setTab] = useState<'buy' | 'orders'>('buy');

  return (
    <Screen scroll>
      <Text variant="title" style={{ marginTop: t.spacing(3), marginBottom: t.spacing(4) }}>USDT</Text>
      <Row gap={2} style={{ marginBottom: t.spacing(4) }}>
        {(['buy', 'orders'] as const).map((k) => {
          const active = k === tab;
          return (
            <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: t.spacing(2.5), borderRadius: t.radius.pill, backgroundColor: active ? t.colors.primary : t.colors.surface, borderWidth: 1, borderColor: active ? t.colors.primary : t.colors.border }}>
              <Text variant="label" weight="semibold" style={{ color: active ? t.colors.onPrimary : t.colors.text }}>{k === 'buy' ? 'Comprar' : 'Minhas ordens'}</Text>
            </Pressable>
          );
        })}
      </Row>
      {tab === 'buy' ? <BuyTab /> : <OrdersTab />}
    </Screen>
  );
}

function BuyTab() {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const offers = useP2POffers();
  const [selected, setSelected] = useState<P2POffer | null>(null);

  if (selected) return <BuyForm offer={selected} onDone={() => setSelected(null)} />;

  const active = (offers.data ?? []).filter((o) => o.status === 'active' && BigInt(o.remainingMinor) > 0n);
  if (offers.isLoading) return <Text variant="body" color="textMuted" center>{tr('common.loading')}</Text>;
  if (!active.length) return <EmptyState title="Nenhuma oferta de USDT disponível" icon={<Ionicons name="logo-usd" size={26} color={t.colors.primary} />} />;

  return (
    <View style={{ gap: t.spacing(3) }}>
      {active.map((o) => (
        <Card key={o.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Text variant="body" weight="bold">{`${o.pricePerUnit} ${o.fiatCurrency} / USDT`}</Text>
              <Text variant="caption" color="textMuted">{`Disponível: ${money(o.remainingMinor, 'USDT')} USDT`}</Text>
              <Text variant="caption" color="textMuted">{o.methods.map((m) => m.label).join(' · ')}</Text>
            </View>
            <Button title="Comprar" onPress={() => setSelected(o)} />
          </Row>
        </Card>
      ))}
    </View>
  );
}

function BuyForm({ offer, onDone }: { offer: P2POffer; onDone: () => void }) {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const [amount, setAmount] = useState('');
  const [order, setOrder] = useState<P2POrder | null>(null);
  const [proof, setProof] = useState('');
  const open = useOpenP2POrder();
  const pay = useP2PPay();

  const amountNum = Number(amount);
  const estFiat = amountNum > 0 ? (amountNum * Number(offer.pricePerUnit)).toFixed(2) : '0.00';

  if (order) {
    // Payment instructions + proof submission.
    return (
      <Screen scroll footer={<Button title="Confirmar pagamento" disabled={proof.trim().length < 3 || pay.isPending} loading={pay.isPending} onPress={() => {
        pay.mutate({ id: order.id, proofRef: proof.trim() }, {
          onSuccess: () => { toast.success('Pagamento informado — aguarde a confirmação do vendedor'); onDone(); },
          onError: (e) => toast.error(messageForError(e, tr)),
        });
      }} />}>
        <Text variant="title" style={{ marginVertical: t.spacing(3) }}>Pague ao vendedor</Text>
        <Card>
          <Line label="Você recebe" value={`${money(order.netToBuyerMinor, 'USDT')} USDT`} strong />
          <Line label="Você paga" value={`${money(order.fiatMinor, order.fiatCurrency)} ${order.fiatCurrency}`} />
          <Divider spacing={1} />
          <Line label="Método" value={order.method.label} />
          <Line label="Conta" value={order.method.account} />
        </Card>
        <Text variant="caption" color="textMuted" style={{ marginVertical: t.spacing(3) }}>
          Faça o pagamento pelo método acima e informe abaixo o comprovante (link/ID). O vendedor confere e libera o USDT.
        </Text>
        <Input label="Comprovante (link ou ID)" value={proof} onChangeText={setProof} placeholder="https://... ou nº da transação" />
      </Screen>
    );
  }

  return (
    <Screen scroll footer={<Button title="Abrir ordem" disabled={amountNum <= 0 || open.isPending} loading={open.isPending} onPress={() => {
      open.mutate({ offerId: offer.id, amount: amount.trim() }, {
        onSuccess: (o) => setOrder(o),
        onError: (e) => toast.error(messageForError(e, tr)),
      });
    }} />}>
      <Pressable onPress={onDone} style={{ marginVertical: t.spacing(3) }}><Text color="primary">‹ Voltar</Text></Pressable>
      <Text variant="title" style={{ marginBottom: t.spacing(3) }}>Comprar USDT</Text>
      <Card style={{ marginBottom: t.spacing(4) }}>
        <Line label="Preço" value={`${offer.pricePerUnit} ${offer.fiatCurrency} / USDT`} />
        <Line label="Disponível" value={`${money(offer.remainingMinor, 'USDT')} USDT`} />
      </Card>
      <Input label="Quanto de USDT" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))} keyboardType="decimal-pad" placeholder="0.00" />
      <Card style={{ marginTop: t.spacing(4) }}>
        <Line label="Você paga (aprox.)" value={`${estFiat} ${offer.fiatCurrency}`} strong />
      </Card>
    </Screen>
  );
}

function OrdersTab() {
  const t = useTheme();
  const toast = useToast();
  const { t: tr } = useI18n();
  const orders = useP2POrders('buyer');
  const cancel = useCancelP2POrder();
  const dispute = useDisputeP2POrder();

  if (orders.isLoading) return <Text variant="body" color="textMuted" center>{tr('common.loading')}</Text>;
  const rows = orders.data ?? [];
  if (!rows.length) return <EmptyState title="Você ainda não tem ordens" icon={<Ionicons name="receipt-outline" size={26} color={t.colors.primary} />} />;

  return (
    <View style={{ gap: t.spacing(3) }}>
      {rows.map((o) => (
        <Card key={o.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" weight="bold">{`${money(o.netToBuyerMinor, 'USDT')} USDT`}</Text>
              <Text variant="caption" color="textMuted">{STATUS_LABEL[o.status]}</Text>
            </View>
            {o.status === 'created' && (
              <Button variant="ghost" title="Cancelar" onPress={() => cancel.mutate(o.id, { onError: (e) => toast.error(messageForError(e, tr)) })} />
            )}
            {o.status === 'payment_submitted' && (
              <Button variant="ghost" title="Abrir disputa" onPress={() => dispute.mutate({ id: o.id, reason: 'Paguei mas não recebi o USDT' }, { onSuccess: () => toast.success('Disputa aberta — a central vai analisar'), onError: (e) => toast.error(messageForError(e, tr)) })} />
            )}
          </Row>
        </Card>
      ))}
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: t.spacing(1.5) }}>
      <Text variant="body" color="textMuted">{label}</Text>
      <Text variant="body" weight={strong ? 'bold' : 'semibold'} color={strong ? 'primary' : 'text'}>{value}</Text>
    </Row>
  );
}
