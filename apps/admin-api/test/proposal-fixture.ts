import type { QuoteProposalV1 } from "@travelos/contracts/share";

const money = (minorUnits: string) => ({ minorUnits, currency: "EUR", scale: 2 });

export const sampleProposal = (overrides: { withImages?: boolean } = {}): QuoteProposalV1 => {
  const img = overrides.withImages === true;
  const image = (url: string): string | null => (img ? url : null);
  return {
    schemaVersion: 1,
    agency: { displayName: "Agência Exemplo Viagens" },
    quote: {
      number: "ORC-2027-0042",
      title: "Madeira ao ritmo do Atlântico",
      destination: "Madeira, Portugal",
      intro:
        "Sete dias entre levadas, miradouros e mesas de bairro, pensados para dois viajantes que gostam de ir devagar.",
      heroImageUrl: image("https://images.example.test/hero.jpg"),
      startDate: "2027-06-14",
      endDate: "2027-06-20",
      nights: 6,
      adults: 2,
      children: 0,
      currency: "EUR",
      validUntil: "2027-03-15",
    },
    totals: {
      pvpFinal: money("345000"),
      perPerson: money("172500"),
      deposit: money("103500"),
      balance: money("241500"),
      balanceDueDate: "2027-05-14",
    },
    flights: [
      {
        direction: "OUTBOUND",
        date: "2027-06-14",
        departTime: "09:20",
        arriveTime: "11:20",
        fromIata: "OPO",
        toIata: "FNC",
        carrier: "Example Air",
        flightNumber: "EA1234",
        baggage: "1 mala de porão de 23 kg",
      },
      {
        direction: "RETURN",
        date: "2027-06-20",
        departTime: "18:10",
        arriveTime: "20:10",
        fromIata: "FNC",
        toIata: "OPO",
        carrier: "Example Air",
        flightNumber: "EA1235",
        baggage: "1 mala de porão de 23 kg",
      },
    ],
    accommodations: [
      {
        service: "Hotel Atlântico Exemplo",
        location: "Funchal",
        roomType: "Quarto duplo deluxe, vista mar",
        boardBasis: "Pequeno-almoço incluído",
        startDate: "2027-06-14",
        endDate: "2027-06-20",
        nights: 6,
        imageUrl: image("https://images.example.test/hotel.jpg"),
        description: "Hotel de falésia com piscina de água salgada, a dez minutos a pé da baixa.",
      },
    ],
    otherServices: [
      {
        category: "Transfers",
        service: "Transfer privado aeroporto – hotel",
        description: "Receção à chegada e acompanhamento até ao alojamento.",
        startDate: "2027-06-14",
        imageUrl: image("https://images.example.test/transfer.jpg"),
      },
    ],
    days: [
      {
        dayIndex: 0,
        date: "2027-06-14",
        title: "Chegada ao Funchal",
        description: "Transfer e check-in. Fim de tarde livre na marina.",
      },
      {
        dayIndex: 1,
        date: "2027-06-15",
        title: "Monte e Mercado dos Lavradores",
        description: "Teleférico, jardins e almoço entre bancas de fruta.",
      },
      { dayIndex: 2, date: "2027-06-16", title: "Pico do Areeiro", description: null },
    ],
    options: [
      {
        service: "Jantar com vista sobre a baía",
        description: "Mesa reservada num restaurante de peixe fresco.",
        pvp: money("12000"),
      },
      { service: "Excursão de dia inteiro ao Porto Moniz", description: null, pvp: money("8500") },
    ],
    included: [
      { label: "Transporte", items: ["Voos de ida e volta", "Transfer privado"] },
      { label: "Estadia", items: ["6 noites com pequeno-almoço"] },
    ],
    excluded: ["Almoços e jantares", "Seguro de viagem", "Despesas pessoais"],
  };
};
