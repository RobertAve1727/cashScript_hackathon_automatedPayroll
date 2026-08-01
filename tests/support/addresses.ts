/**
 * Real CashAddresses, generated with libauth so their checksums are genuine.
 *
 * Made-up addresses would pass the domain's structural check and fail the
 * `AddressValidator` — which is exactly the distinction these tests exist to
 * verify, so the fixtures have to be real.
 */
export const ALICE_TESTNET = 'bchtest:qz89uypvkrz89v25smwfwl88wpkryywv9v93x698ty';
export const BOB_TESTNET = 'bchtest:qr7ccxqsqur7a058w2rrz7gxtx2pz4g45gsxh8wz2k';
export const CAROL_TESTNET = 'bchtest:qrt43y86wfzaewacm40czmexdch39vulhvjxhgcfgw';

export const ALICE_MAINNET = 'bitcoincash:qz89uypvkrz89v25smwfwl88wpkryywv9vprza8svc';

/** Structurally valid, checksum deliberately corrupted in the final character. */
export const INVALID_CHECKSUM_TESTNET = 'bchtest:qqqqzqsrqszsvpcgpy9qkrqdpc83qygjzvupc7a6vq';
