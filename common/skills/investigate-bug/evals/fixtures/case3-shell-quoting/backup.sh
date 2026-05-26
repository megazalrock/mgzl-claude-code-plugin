#!/bin/bash
SOURCE=/data/source
DEST=/data/backup

mkdir -p $DEST

for f in $(ls $SOURCE); do
  cp $SOURCE/$f $DEST/$f
done

echo "backup done"
