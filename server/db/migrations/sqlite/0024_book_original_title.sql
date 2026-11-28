ALTER TABLE `user_books` ADD `original_title` text;--> statement-breakpoint
UPDATE user_books
SET original_title = trim(json_extract(books.open_library_metadata, '$.editionDetails.originalTitle'))
FROM books
WHERE books.id = user_books.book_id
  AND CASE WHEN json_valid(books.open_library_metadata)
    THEN json_type(books.open_library_metadata, '$.editionDetails.originalTitle') = 'text'
      AND length(trim(json_extract(books.open_library_metadata, '$.editionDetails.originalTitle'))) BETWEEN 1 AND 500
    ELSE 0 END;
