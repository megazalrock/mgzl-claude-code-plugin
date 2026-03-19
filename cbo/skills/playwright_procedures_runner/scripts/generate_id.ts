#!/usr/bin/env bun
const main = () => {
  const charTable = [
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    ['j', 'k', 'l', 'm', 'n', 'p', 'q', 'r'],
    ['s', 't', 'u', 'v', 'w', 'x', 'y', 'z'],
    ['2', '3', '4', '5', '6', '7', '8', '9']
  ];

  const result = charTable
    .map((row) => {
      // charTable の各行は固定長8要素のため、インデックスが範囲外になることはない
      return row[Math.floor(Math.random() * row.length)]!
    })
    .join('');

  console.log(result);
}

main()
