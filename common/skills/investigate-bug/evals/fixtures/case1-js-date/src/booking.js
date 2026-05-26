const { formatDateForDisplay } = require('./format');

function createBooking(input) {
  // input.date は "2024-01-15" のような ISO 形式の文字列
  const bookingDate = new Date(input.date);

  return {
    customerId: input.customerId,
    date: bookingDate,
    displayDate: formatDateForDisplay(bookingDate),
    createdAt: new Date(),
  };
}

module.exports = { createBooking };
