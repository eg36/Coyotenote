//go:build !unix

package main

func registerTermination(func()) {}
