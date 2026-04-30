use crate::engine::ColumnSchema;

pub fn sanitize_identifier(raw: &str) -> String {
    let mut output = String::with_capacity(raw.len());

    for (index, character) in raw.chars().enumerate() {
        let normalized = if character.is_ascii_alphanumeric() {
            character.to_ascii_lowercase()
        } else {
            '_'
        };

        if index == 0 && !normalized.is_ascii_alphabetic() {
            output.push('t');
            output.push('_');
        }

        output.push(normalized);
    }

    if output.is_empty() {
        return String::from("t_csv");
    }

    let compact = output.trim_matches('_').to_string();
    if compact.is_empty() {
        String::from("t_csv")
    } else {
        compact
    }
}

pub fn quote_identifier(identifier: &str) -> String {
    let escaped = identifier.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

pub fn escape_string_literal(value: &str) -> String {
    value.replace('\'', "''")
}

pub fn build_register_view_sql(table_name: &str, csv_path: &str) -> String {
    format!(
        "CREATE OR REPLACE VIEW {} AS SELECT * FROM read_csv_auto('{}', SAMPLE_SIZE=20000, IGNORE_ERRORS=true);",
        quote_identifier(table_name),
        escape_string_literal(csv_path)
    )
}

pub fn build_drop_view_sql(table_name: &str) -> String {
    format!("DROP VIEW IF EXISTS {}", quote_identifier(table_name))
}

pub fn build_default_query(table_name: &str) -> String {
    format!("SELECT * FROM {}", quote_identifier(table_name))
}

pub fn build_describe_query_sql(sql: &str) -> String {
    format!("DESCRIBE SELECT * FROM ({sql}) AS tapir_result")
}

pub fn build_paged_select_sql(
    sql: &str,
    columns: &[ColumnSchema],
    limit: usize,
    offset: usize,
) -> String {
    let projections = columns
        .iter()
        .map(|column| {
            let name = quote_identifier(&column.name);
            format!("CAST({name} AS VARCHAR) AS {name}")
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!("SELECT {projections} FROM ({sql}) AS tapir_result LIMIT {limit} OFFSET {offset}")
}

pub fn build_materialized_session_sql(sql: &str, session_table_name: &str) -> String {
    format!(
        "CREATE OR REPLACE TEMP TABLE {} AS SELECT * FROM ({sql}) AS tapir_result;",
        quote_identifier(session_table_name)
    )
}

pub fn build_paged_session_sql(
    session_table_name: &str,
    columns: &[String],
    limit: usize,
    offset: usize,
) -> String {
    let projections = columns
        .iter()
        .map(|column| {
            let name = quote_identifier(column);
            format!("CAST({name} AS VARCHAR) AS {name}")
        })
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "SELECT {projections} FROM {} LIMIT {limit} OFFSET {offset}",
        quote_identifier(session_table_name)
    )
}

pub fn build_count_table_sql(table_name: &str) -> String {
    format!("SELECT COUNT(*) FROM {}", quote_identifier(table_name))
}

pub fn build_drop_table_sql(table_name: &str) -> String {
    format!("DROP TABLE IF EXISTS {}", quote_identifier(table_name))
}

pub fn build_count_sql(sql: &str) -> String {
    format!("SELECT COUNT(*) FROM ({sql}) AS tapir_result")
}

pub fn build_export_csv_sql(sql: &str, output_path: &str) -> String {
    format!(
        "COPY ({sql}) TO '{}' (FORMAT CSV, HEADER, DELIMITER ',');",
        escape_string_literal(output_path)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_paged_query_for_sample_schema() {
        let schema = vec![
            ColumnSchema {
                name: String::from("amount"),
                data_type: String::from("DOUBLE"),
            },
            ColumnSchema {
                name: String::from("booking_date"),
                data_type: String::from("DATE"),
            },
            ColumnSchema {
                name: String::from("customer id"),
                data_type: String::from("VARCHAR"),
            },
        ];

        let sql = build_paged_select_sql(
            "SELECT * FROM transactions WHERE amount > 1000",
            &schema,
            200,
            0,
        );

        assert!(sql.contains("CAST(\"amount\" AS VARCHAR) AS \"amount\""));
        assert!(sql.contains("CAST(\"booking_date\" AS VARCHAR) AS \"booking_date\""));
        assert!(sql.contains("CAST(\"customer id\" AS VARCHAR) AS \"customer id\""));
        assert!(sql.contains("LIMIT 200 OFFSET 0"));
    }

    #[test]
    fn builds_materialized_session_query() {
        let sql = build_materialized_session_sql("SELECT * FROM transactions", "tapir_session_1");

        assert!(sql.contains("CREATE OR REPLACE TEMP TABLE \"tapir_session_1\""));
        assert!(sql.contains("SELECT * FROM (SELECT * FROM transactions) AS tapir_result"));
    }

    #[test]
    fn builds_paged_materialized_session_query() {
        let sql = build_paged_session_sql(
            "tapir_session_1",
            &[String::from("amount"), String::from("customer id")],
            100,
            300,
        );

        assert!(sql.contains("FROM \"tapir_session_1\""));
        assert!(sql.contains("CAST(\"amount\" AS VARCHAR) AS \"amount\""));
        assert!(sql.contains("CAST(\"customer id\" AS VARCHAR) AS \"customer id\""));
        assert!(sql.contains("LIMIT 100 OFFSET 300"));
    }
}
