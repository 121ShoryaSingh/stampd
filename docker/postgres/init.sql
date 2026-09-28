create role stampd_migrator login password 'migrator' bypassrls createdb;
create role stampd_app login password 'app';
create database stampd owner stampd_migrator;
