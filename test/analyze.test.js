import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeQuery, buildSourceQuery } from '../src/analyze.js'

test('analyzer detects identifiers, sequences and taxon names', () => {
  assert.deepEqual(analyzeQuery('10.1038/nature123'), { kind: 'doi', value: '10.1038/nature123', label: 'DOI' })
  assert.equal(analyzeQuery('https://doi.org/10.1038/nature123.').value, '10.1038/nature123')
  assert.equal(analyzeQuery('PMID: 39000001').kind, 'pmid')
  assert.equal(analyzeQuery('https://pubmed.ncbi.nlm.nih.gov/10944877/').value, '10944877')
  assert.equal(analyzeQuery('P68871').kind, 'uniprot')
  assert.equal(analyzeQuery('GCA_000155005.1').kind, 'accession')
  assert.equal(analyzeQuery('NP_000001.1').kind, 'accession')

  const dna = analyzeQuery('ACGTACGTACGTACGTACGTACGT')
  assert.equal(dna.kind, 'sequence')
  assert.equal(dna.sequenceType, 'dna')
  const protein = analyzeQuery('MKTIIALSYIFCLVFADYKDDDDK')
  assert.equal(protein.kind, 'sequence')
  assert.equal(protein.sequenceType, 'protein')

  assert.equal(analyzeQuery('Escherichia coli').kind, 'taxon')
  assert.equal(analyzeQuery('Escherichia coli K-12').kind, 'taxon')
  assert.equal(analyzeQuery('Candidatus Nitrosopumilus').kind, 'taxon')
  assert.equal(analyzeQuery('The quick brown fox').kind, 'text')
  assert.equal(analyzeQuery('  ').kind, 'text')
})

test('taxon names use provider-specific fields', () => {
  const analysis = analyzeQuery('Escherichia coli')
  assert.equal(buildSourceQuery('ncbi', 'Escherichia coli', analysis), '"Escherichia coli"[Organism]')
  assert.equal(buildSourceQuery('uniprot', 'Escherichia coli', analysis), 'organism_name:"Escherichia coli"')
  assert.equal(buildSourceQuery('pubmed', 'Escherichia coli', analysis), '"Escherichia coli"[Title/Abstract]')
  assert.equal(buildSourceQuery('europepmc', 'Escherichia coli', analysis), 'TITLE_ABS:"Escherichia coli"')
  assert.equal(buildSourceQuery('gtdb', 'Escherichia coli', analysis), 'Escherichia coli')
  assert.equal(buildSourceQuery('bacdive', 'Escherichia coli', analysis), 'Escherichia coli')
})

test('identifiers take the syntax each literature or sequence source expects', () => {
  const doi = analyzeQuery('10.1038/nature123')
  assert.equal(buildSourceQuery('pubmed', '10.1038/nature123', doi), '"10.1038/nature123"[DOI]')
  assert.equal(buildSourceQuery('europepmc', '10.1038/nature123', doi), 'DOI:"10.1038/nature123"')

  const pmid = analyzeQuery('PMID: 39000001')
  assert.equal(buildSourceQuery('pubmed', 'PMID: 39000001', pmid), '39000001[PMID]')
  assert.equal(buildSourceQuery('europepmc', 'PMID: 39000001', pmid), 'EXT_ID:39000001')

  const uniprot = analyzeQuery('P68871')
  assert.equal(buildSourceQuery('uniprot', 'P68871', uniprot), 'P68871')
  assert.equal(buildSourceQuery('ncbi', 'P68871', uniprot), 'P68871')

  const accession = analyzeQuery('GCA_000155005.1')
  assert.equal(buildSourceQuery('gtdb', 'GCA_000155005.1', accession), 'GCA_000155005.1')
  assert.equal(buildSourceQuery('silva', 'GCA_000155005.1', accession), 'GCA_000155005.1')
})

test('raw text and sequences stay unchanged, and quotes are neutralized', () => {
  assert.equal(buildSourceQuery('ncbi', 'some free text', analyzeQuery('some free text')), 'some free text')
  assert.equal(buildSourceQuery('pubmed', 'ACGTACGTACGTACGTACGT', analyzeQuery('ACGTACGTACGTACGTACGT')), 'ACGTACGTACGTACGTACGT')
  assert.equal(
    buildSourceQuery('pubmed', 'x', { kind: 'taxon', value: 'Escherichia "coli"', label: '' }),
    '"Escherichia coli"[Title/Abstract]',
  )
})
