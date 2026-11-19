import assert from 'node:assert/strict';
import test from 'node:test';
import { addressTextForSave, formatManualAddress, formatPersonName, hasGivenNameAndSurname } from './format.ts';

test('rejects a single-word name and accepts multi-part names', () => {
  assert.equal(hasGivenNameAndSurname('Tariro'), false);
  assert.equal(hasGivenNameAndSurname('  Michael   Munatsi  '), true);
  assert.equal(hasGivenNameAndSurname('Mary Ann Smith'), true);
  assert.equal(hasGivenNameAndSurname("Mary-Ann O'Connor"), true);
  assert.equal(hasGivenNameAndSurname('Jo Lee'), true);
  assert.equal(hasGivenNameAndSurname('John 2'), false);
});

test('formats names and manual places without corrupting punctuation or abbreviations', () => {
  assert.equal(formatPersonName('michael munatsi'), 'Michael Munatsi');
  assert.equal(formatPersonName('JOHN DOE'), 'John Doe');
  assert.equal(formatPersonName('mary ann smith'), 'Mary Ann Smith');
  assert.equal(formatPersonName("o'connor mcdonald"), "O'Connor McDonald");
  assert.equal(formatManualAddress('borrowdale west'), 'Borrowdale West');
  assert.equal(formatManualAddress('12 samora machel, cbd, harare'), '12 Samora Machel, CBD, Harare');
  assert.equal(formatManualAddress("mcdonald road, borrowdale west"), 'McDonald Road, Borrowdale West');
});

test('keeps an autocomplete address and formats only manual entry', () => {
  const selected = '12 Samora Machel Avenue, Borrowdale, Harare';
  assert.equal(addressTextForSave(selected, 'GOOGLE_PLACES'), selected);
  assert.equal(addressTextForSave('  borrowdale   west ', null), 'Borrowdale West');
  assert.equal(addressTextForSave('PO Box 12, Harare', 'DEVICE_GEOCODER'), 'PO Box 12, Harare');
});
