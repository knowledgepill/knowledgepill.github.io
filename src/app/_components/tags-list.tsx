export function TagsList(props: { tags: string[] }) {
  return (
    <>
      {props.tags && props.tags.length > 0 && props.tags.map((tag) => (
        <span key={tag}
              className="inline-block bg-gray-50 px-3 py-1 text-xs font-light text-gray-700 mr-2 mb-2">
            {tag}
          </span>
      ))}
    </>
  );
}